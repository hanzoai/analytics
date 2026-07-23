import { z } from 'zod';
import * as send from '@/app/api/send/route';
import { parseRequest } from '@/lib/request';
import { serverError } from '@/lib/response';
import { anyObjectParam } from '@/lib/schema';
import { getWebsiteByHost } from '@/queries/prisma';

/**
 * POST /v1/event — the ONE ingest for the hz.js tag.
 *
 * Body is a sendBeacon batch: a JSON array of structured events
 *   { site, ts, type, path, ref, props, anon, sid, w, h }
 * type ∈ pageview | click | outbound | scroll | form | event | identify | vitals.
 *
 * Each row resolves site -> website id, then maps onto the engine's existing
 * collect envelope ({ type, payload }) and is processed by the shared send
 * handler — reusing the exact persistence path as /v1/send (no new datastore).
 *   · pageview            -> the engine's pageview/session record
 *   · everything else     -> a custom-event record named by its type, with the
 *                            hz.js `props` (element locator / depth / vitals /
 *                            traits) preserved verbatim as queryable event data
 *   · identify            -> the engine's session-data (traits) record
 * Session is keyed by `sid`, visitor by `anon`. Tolerant: unknown sites and bad
 * rows are dropped, never 500 the batch.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schema = z.array(anyObjectParam);

// Map an hz.js event onto the { type, payload } collect envelope.
function toEnvelope(event: any, websiteId: string) {
  const kind = event?.type;
  const props = event?.props && typeof event.props === 'object' ? event.props : undefined;

  // pageview -> pageView (no name). identify -> handled via type. event -> the
  // manual name in props.name. Autocapture kinds (click/outbound/scroll/form/
  // vitals) are named by their type so they become queryable custom events with
  // the locator preserved as data.
  const name =
    kind === 'pageview' || kind === 'identify'
      ? undefined
      : kind === 'event'
        ? String(props?.name ?? 'event').slice(0, 50)
        : String(kind ?? 'event').slice(0, 50);

  const screen =
    event?.w && event?.h && `${event.w}x${event.h}`.length <= 11
      ? `${event.w}x${event.h}`
      : undefined;

  return {
    type: kind === 'identify' ? 'identify' : 'event',
    payload: {
      website: websiteId,
      hostname: typeof event?.site === 'string' ? event.site : undefined,
      url: event?.path || '/',
      referrer: event?.ref || undefined,
      screen,
      timestamp: typeof event?.ts === 'number' ? Math.floor(event.ts / 1000) : undefined,
      id: event?.sid || event?.anon || undefined, // session keyed by sid
      distinctId: event?.anon || event?.sid || undefined, // visitor keyed by anon
      name,
      data: props,
    },
  };
}

export async function POST(request: Request) {
  try {
    const { body, error } = await parseRequest(request, schema, { skipAuth: true });

    if (error) {
      return error();
    }

    const sites = new Map<string, string | null>();

    const resolve = async (site: unknown): Promise<string | null> => {
      if (typeof site !== 'string' || !site) return null;
      if (sites.has(site)) return sites.get(site);
      const id = UUID_RE.test(site) ? site : ((await getWebsiteByHost(site))?.id ?? null);
      sites.set(site, id);
      return id;
    };

    for (const event of body) {
      const websiteId = await resolve(event?.site);
      if (!websiteId) continue; // unknown property — drop, don't fabricate

      const headers = new Headers(request.headers);
      headers.set('content-type', 'application/json');
      headers.delete('content-length');

      const newRequest = new Request(request.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(toEnvelope(event, websiteId)),
      });

      try {
        await send.POST(newRequest);
      } catch {
        // tolerate bad rows — never fail the batch
      }
    }

    return new Response(null, { status: 204 });
  } catch (e) {
    return serverError(e);
  }
}
