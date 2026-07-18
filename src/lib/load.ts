import type { Session, Website } from '@/generated/prisma/client';
import redis from '@/lib/redis';
import { getWebsite } from '@/queries/prisma';
import { getWebsiteSession } from '@/queries/sql';

// The KV cache is best-effort and must never block ingestion. node-redis queues
// commands against an unreachable host indefinitely (no command timeout), so a
// misconfigured or down KV would otherwise hang every collect request forever.
// Bound each cache read and fall back to the database, which is the source of truth.
const CACHE_TIMEOUT_MS = 1000;

async function cached<T>(key: string, query: () => Promise<T>, ttl: number): Promise<T> {
  if (!redis.enabled) {
    return query();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      redis.client.fetch(key, query, ttl) as Promise<T>,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('kv timeout')), CACHE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // KV unavailable or slow — serve from the database instead.
    return query();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWebsite(websiteId: string): Promise<Website> {
  const website = await cached(`website:${websiteId}`, () => getWebsite(websiteId), 86400);

  if (!website || website.deletedAt) {
    return null;
  }

  return website;
}

export async function fetchSession(websiteId: string, sessionId: string): Promise<Session> {
  const session = await cached(
    `session:${sessionId}`,
    () => getWebsiteSession(websiteId, sessionId),
    86400,
  );

  if (!session) {
    return null;
  }

  return session;
}
