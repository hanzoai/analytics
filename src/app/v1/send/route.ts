import { startOfHour, startOfMonth } from 'date-fns';
import { isbot } from 'isbot';
import { serializeError } from 'serialize-error';
import { z } from 'zod';
import { COLLECTION_TYPE, EVENT_TYPE } from '@/lib/constants';
import { hash, secret, uuid } from '@/lib/crypto';
import datastore from '@/lib/datastore';
import { getClientInfo, hasBlockedIp } from '@/lib/detect';
import { enforceServerPaymentTrustBoundary, isTrustedServerEventRequest } from '@/lib/funnel';
import { extractCrossDomainIdentity, resolveCanonicalVisitorId } from '@/lib/identity';
import { createToken, parseToken } from '@/lib/jwt';
import { fetchWebsite } from '@/lib/load';
import { isUxCaptureExcludedRoute, sanitizeReplayChunkBeforeStorage } from '@/lib/privacy';
import { parseRequest } from '@/lib/request';
import { badRequest, forbidden, json, serverError } from '@/lib/response';
import { anyObjectParam, urlOrPathParam } from '@/lib/schema';
import { safeDecodeURI, safeDecodeURIComponent } from '@/lib/url';
import { createSession, saveEvent, saveRecording, saveSessionData } from '@/queries/sql';

interface Cache {
  websiteId: string;
  sessionId: string;
  visitId: string;
  iat: number;
}

const schema = z.object({
  type: z.enum(['event', 'identify', 'record']),
  payload: z
    .object({
      website: z.uuid().optional(),
      link: z.uuid().optional(),
      pixel: z.uuid().optional(),
      data: anyObjectParam.optional(),
      hostname: z.string().max(100).optional(),
      language: z.string().max(35).optional(),
      referrer: urlOrPathParam.optional(),
      screen: z.string().max(11).optional(),
      title: z.string().optional(),
      url: urlOrPathParam.optional(),
      name: z.string().max(50).optional(),
      tag: z.string().max(50).optional(),
      ip: z.string().optional(),
      userAgent: z.string().optional(),
      timestamp: z.coerce.number().int().optional(),
      id: z.string().optional(),
      hz_aid: z.string().max(128).optional(),
      hz_sid: z.string().max(128).optional(),
      visitor_id: z.string().max(128).optional(),
      browser: z.string().optional(),
      os: z.string().optional(),
      device: z.string().optional(),
      // Session-replay chunk (type: 'record'). events is an rrweb batch, kept as
      // unknown[] because rrweb's shapes are its own and this route only counts,
      // bounds and forwards them — it never interprets one. The 5000 cap bounds a
      // single request; the recorder already flushes every 100 events, so a batch
      // near the cap is a malformed or hostile client, not a busy page.
      events: z.array(z.unknown()).max(5000).optional(),
      chunkIndex: z.coerce.number().int().min(0).optional(),
      startedAt: z.coerce.number().int().optional(),
      endedAt: z.coerce.number().int().optional(),
    })
    .refine(
      data => {
        const keys = [data.website, data.link, data.pixel];
        const count = keys.filter(Boolean).length;
        return count === 1;
      },
      {
        message: 'Exactly one of website, link, or pixel must be provided',
        path: ['website'],
      },
    ),
});

export async function POST(request: Request) {
  try {
    const { body, error } = await parseRequest(request, schema, { skipAuth: true });

    if (error) {
      return error();
    }

    const { type, payload } = body;

    const {
      website: websiteId,
      pixel: pixelId,
      link: linkId,
      hostname,
      screen,
      language,
      url,
      referrer,
      name,
      data,
      title,
      tag,
      timestamp,
      id,
      hz_aid,
      hz_sid,
      visitor_id,
      events,
      chunkIndex,
      startedAt,
      endedAt,
    } = payload;

    const crossDomainIdentity = extractCrossDomainIdentity(url, {
      hz_aid: hz_aid ?? data?.hz_aid,
      hz_sid: hz_sid ?? data?.hz_sid,
      visitor_id: visitor_id ?? data?.visitor_id,
    });
    const canonicalVisitorId = resolveCanonicalVisitorId({
      distinctId: id,
      visitor_id: crossDomainIdentity.visitor_id,
      hz_aid: crossDomainIdentity.hz_aid,
    });

    const sourceId = websiteId || pixelId || linkId;

    // Cache check
    let cache: Cache | null = null;

    if (websiteId) {
      const cacheHeader = request.headers.get('x-cache-hint');

      if (cacheHeader) {
        const result = await parseToken(cacheHeader, secret());

        if (result) {
          cache = result;
        }
      }

      // Find website
      if (!cache?.websiteId) {
        const website = await fetchWebsite(websiteId);

        if (!website) {
          return badRequest({ message: 'Website not found.' });
        }
      }
    }

    // Client info
    const { ip, userAgent, device, browser, os, country, region, city } = await getClientInfo(
      request,
      payload,
    );

    // Bot check
    if (!process.env.DISABLE_BOT_CHECK && isbot(userAgent)) {
      return json({ beep: 'boop' });
    }

    // DNT / Global Privacy Control — respect by default; set DISABLE_RESPECT_DNT=true to opt out
    if (process.env.DISABLE_RESPECT_DNT !== 'true') {
      const dnt = request.headers.get('dnt');
      const gpc = request.headers.get('sec-gpc');
      if (dnt === '1' || gpc === '1') {
        return json({ ok: true });
      }
    }

    // IP block
    if (hasBlockedIp(ip)) {
      return forbidden();
    }

    const createdAt = timestamp ? new Date(timestamp * 1000) : new Date();
    const now = Math.floor(Date.now() / 1000);

    const sessionSalt = hash(startOfMonth(createdAt).toUTCString());
    const visitSalt = hash(startOfHour(createdAt).toUTCString());

    const sessionId = canonicalVisitorId
      ? uuid(sourceId, canonicalVisitorId)
      : uuid(sourceId, ip, userAgent, sessionSalt);

    // Create a session if not found
    if (!datastore.enabled && !cache?.sessionId) {
      await createSession({
        id: sessionId,
        websiteId: sourceId,
        browser,
        os,
        device,
        screen,
        language,
        country,
        region,
        city,
        distinctId: canonicalVisitorId,
        createdAt,
      });
    }

    // Visit info
    let visitId = cache?.visitId || uuid(sessionId, visitSalt);
    let iat = cache?.iat || now;

    // Expire visit after 30 minutes
    if (!timestamp && now - iat > 1800) {
      visitId = uuid(sessionId, visitSalt);
      iat = now;
    }

    if (type === COLLECTION_TYPE.event) {
      const base = hostname ? `https://${hostname}` : 'https://localhost';
      const currentUrl = new URL(url, base);

      let urlPath =
        currentUrl.pathname === '/undefined' ? '' : currentUrl.pathname + currentUrl.hash;
      const urlQuery = currentUrl.search.substring(1);
      const urlDomain = currentUrl.hostname.replace(/^www./, '');

      let referrerPath: string;
      let referrerQuery: string;
      let referrerDomain: string;

      // UTM Params
      const utmSource = currentUrl.searchParams.get('utm_source');
      const utmMedium = currentUrl.searchParams.get('utm_medium');
      const utmCampaign = currentUrl.searchParams.get('utm_campaign');
      const utmContent = currentUrl.searchParams.get('utm_content');
      const utmTerm = currentUrl.searchParams.get('utm_term');

      // Click IDs
      const gclid = currentUrl.searchParams.get('gclid');
      const fbclid = currentUrl.searchParams.get('fbclid');
      const msclkid = currentUrl.searchParams.get('msclkid');
      const ttclid = currentUrl.searchParams.get('ttclid');
      const lifatid = currentUrl.searchParams.get('li_fat_id');
      const twclid = currentUrl.searchParams.get('twclid');

      if (process.env.REMOVE_TRAILING_SLASH) {
        urlPath = urlPath.replace(/\/(?=(#.*)?$)/, '');
      }

      if (referrer) {
        const referrerUrl = new URL(referrer, base);

        referrerPath = referrerUrl.pathname;
        referrerQuery = referrerUrl.search.substring(1);
        referrerDomain = referrerUrl.hostname.replace(/^www\./, '');
      }

      const eventType = linkId
        ? EVENT_TYPE.linkEvent
        : pixelId
          ? EVENT_TYPE.pixelEvent
          : name
            ? EVENT_TYPE.customEvent
            : EVENT_TYPE.pageView;

      // Drop UX heatmap events originating from excluded sensitive routes
      const isUxHeatmapEvent =
        name === '$$heatmap' || name === '$$heatmap_aggregate' || name === 'heatmap_click';
      if (isUxHeatmapEvent && isUxCaptureExcludedRoute(urlPath)) {
        const token = createToken({ websiteId, sessionId, visitId, iat }, secret());
        return json({ cache: token, sessionId, visitId, dropped: true, reason: 'excluded_route' });
      }

      // Enforce confirmed server-side payment trust boundary
      const isServerAuthenticated = isTrustedServerEventRequest(request);
      const safeEventData = enforceServerPaymentTrustBoundary(name, data, isServerAuthenticated);
      const enrichedEventData =
        safeEventData ||
        crossDomainIdentity.hz_aid ||
        crossDomainIdentity.hz_sid ||
        crossDomainIdentity.visitor_id
          ? {
              ...(safeEventData || {}),
              ...(crossDomainIdentity.hz_aid ? { hz_aid: crossDomainIdentity.hz_aid } : {}),
              ...(crossDomainIdentity.hz_sid ? { hz_sid: crossDomainIdentity.hz_sid } : {}),
              ...(crossDomainIdentity.visitor_id
                ? { visitor_id: crossDomainIdentity.visitor_id }
                : {}),
            }
          : undefined;

      await saveEvent({
        websiteId: sourceId,
        sessionId,
        visitId,
        eventType,
        createdAt,

        // Page
        pageTitle: safeDecodeURIComponent(title),
        hostname: hostname || urlDomain,
        urlPath: safeDecodeURI(urlPath),
        urlQuery,
        referrerPath: safeDecodeURI(referrerPath),
        referrerQuery,
        referrerDomain,

        // Session
        distinctId: canonicalVisitorId,
        browser,
        os,
        device,
        screen,
        language,
        country,
        region,
        city,

        // Events
        eventName: name,
        eventData: enrichedEventData,
        tag,

        // UTM
        utmSource,
        utmMedium,
        utmCampaign,
        utmContent,
        utmTerm,

        // Click IDs
        gclid,
        fbclid,
        msclkid,
        ttclid,
        lifatid,
        twclid,
      });
    } else if (type === COLLECTION_TYPE.identify) {
      if (data) {
        await saveSessionData({
          websiteId,
          sessionId,
          sessionData: data,
          distinctId: id,
          createdAt,
        });
      }
    } else if (type === COLLECTION_TYPE.record) {
      // Enforce pre-storage route exclusion & DOM scrubbing defense-in-depth so
      // sensitive routes (/auth/callback, /pay/confirm/*, etc.) are never persisted.
      if (events?.length) {
        const sanitized = sanitizeReplayChunkBeforeStorage(events, url);
        if (!sanitized.dropped && sanitized.events.length) {
          await saveRecording({
            websiteId,
            sessionId,
            visitId,
            chunkIndex: chunkIndex ?? 0,
            events: sanitized.events,
            eventCount: sanitized.events.length,
            startedAt: startedAt ? new Date(startedAt) : createdAt,
            endedAt: endedAt ? new Date(endedAt) : createdAt,
          });
        }
      }
    }

    const token = createToken({ websiteId, sessionId, visitId, iat }, secret());

    return json({ cache: token, sessionId, visitId });
  } catch (e) {
    const error = serializeError(e);

    // eslint-disable-next-line no-console
    console.log(error);

    return serverError({ errorObject: error });
  }
}
