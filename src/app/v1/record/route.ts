import { isbot } from 'isbot';
import { serializeError } from 'serialize-error';
import { z } from 'zod';
import { secret } from '@/lib/crypto';
import { getClientInfo, hasBlockedIp } from '@/lib/detect';
import { parseToken } from '@/lib/jwt';
import { fetchAccount, fetchTeam } from '@/lib/load';
import { sanitizeReplayChunkBeforeStorage } from '@/lib/privacy';
import { parseRequest } from '@/lib/request';
import { badRequest, forbidden, json, serverError } from '@/lib/response';
import { getWebsite } from '@/queries/prisma';
import { saveRecording } from '@/queries/sql';

interface Cache {
  sessionId: string;
  visitId: string;
}

const schema = z.object({
  type: z.literal('record'),
  payload: z.object({
    website: z.uuid(),
    events: z.array(z.any()).max(5000),
    url: z.string().max(2048).optional(),
    chunkIndex: z.coerce.number().int().min(0).optional(),
    startedAt: z.coerce.number().int().optional(),
    endedAt: z.coerce.number().int().optional(),
    timestamp: z.coerce.number().int().optional(),
  }),
});

export async function POST(request: Request) {
  try {
    const { body, error } = await parseRequest(request, schema, { skipAuth: true });

    if (error) {
      return error();
    }

    const {
      website: websiteId,
      events,
      url,
      chunkIndex: payloadChunkIndex,
      startedAt: payloadStartedAt,
      endedAt: payloadEndedAt,
      timestamp,
    } = body.payload;

    if (!events?.length) {
      return json({ ok: true });
    }

    const sanitized = sanitizeReplayChunkBeforeStorage(events, url);
    if (sanitized.dropped) {
      return json({ ok: true, dropped: true, reason: sanitized.reason });
    }

    // Parse cache token to get session info (prefer x-cache-hint, fallback to legacy x-umami-cache)
    const cacheHeader = request.headers.get('x-cache-hint') || request.headers.get('x-umami-cache');

    if (!cacheHeader) {
      return badRequest({ message: 'Missing session token.' });
    }

    const cache = (await parseToken(cacheHeader, secret())) as Cache | null;

    if (!cache?.sessionId || !cache?.visitId) {
      return badRequest({ message: 'Invalid session token.' });
    }

    const { sessionId, visitId } = cache;

    // Query directly to avoid stale Redis cache for recordingEnabled
    const website = await getWebsite(websiteId);

    if (!website) {
      return badRequest({ message: 'Website not found.' });
    }

    if (!website.replayEnabled) {
      return json({ ok: false, reason: 'replay_disabled' });
    }

    if (process.env.CLOUD_MODE) {
      const account = website.teamId
        ? await fetchTeam(website.teamId)
        : website.userId
          ? await fetchAccount(website.userId)
          : null;

      if (!account?.isBusiness && !account?.isNoBilling) {
        return forbidden({ message: 'Business subscription required.' });
      }
    }

    // Client info for bot/IP checks
    const { ip, userAgent } = await getClientInfo(request, {});

    if (!process.env.DISABLE_BOT_CHECK && isbot(userAgent)) {
      return json({ beep: 'boop' });
    }

    if (hasBlockedIp(ip)) {
      return forbidden();
    }

    // Compute timestamps from sanitized events
    const eventTimestamps = sanitized.events
      .map((e: any) => Number(e?.timestamp))
      .filter((t: number) => Number.isFinite(t) && t > 0);

    const fallbackMs = (timestamp || Math.floor(Date.now() / 1000)) * 1000;
    const minTimestamp =
      payloadStartedAt ?? (eventTimestamps.length ? Math.min(...eventTimestamps) : fallbackMs);
    const maxTimestamp =
      payloadEndedAt ?? (eventTimestamps.length ? Math.max(...eventTimestamps) : fallbackMs);

    const startedAt = new Date(minTimestamp);
    const endedAt = new Date(maxTimestamp);

    // Prefer monotonic chunkIndex from recorder, fallback to timestamp
    const chunkIndex = payloadChunkIndex ?? timestamp ?? Math.floor(Date.now() / 1000);

    await saveRecording({
      websiteId,
      sessionId,
      visitId,
      chunkIndex,
      events: sanitized.events,
      eventCount: sanitized.events.length,
      startedAt,
      endedAt,
    });

    return json({ ok: true });
  } catch (e) {
    const error = serializeError(e);

    // eslint-disable-next-line no-console
    console.log(error);

    return serverError({ errorObject: error });
  }
}
