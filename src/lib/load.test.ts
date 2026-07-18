/**
 * KV cache resilience.
 *
 * A slow or unreachable KV must never block ingestion: fetchWebsite /
 * fetchSession bound the cache read and fall back to the database (the source
 * of truth). Regression test for the analytics.hanzo.ai outage where a dead
 * KV_URL (redis-master, ENOTFOUND) hung every POST /api/send indefinitely
 * because node-redis queues commands against an unreachable host with no
 * command timeout.
 */

jest.mock('@/lib/redis', () => ({
  __esModule: true,
  default: { enabled: true, client: { fetch: jest.fn() } },
}));
jest.mock('@/queries/prisma', () => ({ getWebsite: jest.fn() }));
jest.mock('@/queries/sql', () => ({ getWebsiteSession: jest.fn() }));

import redis from '@/lib/redis';
import { getWebsite } from '@/queries/prisma';
import { getWebsiteSession } from '@/queries/sql';
import { fetchSession, fetchWebsite } from './load';

const kv = redis as unknown as { enabled: boolean; client: { fetch: jest.Mock } };
const dbWebsite = getWebsite as unknown as jest.Mock;
const dbSession = getWebsiteSession as unknown as jest.Mock;

const WEBSITE = { id: 'w1', deletedAt: null };
const SESSION = { id: 's1' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  kv.enabled = true;
});

describe('fetchWebsite', () => {
  test('returns the cached value without touching the database on a KV hit', async () => {
    kv.client.fetch.mockResolvedValue(WEBSITE);

    await expect(fetchWebsite('w1')).resolves.toEqual(WEBSITE);
    expect(dbWebsite).not.toHaveBeenCalled();
  });

  test('falls back to the database when KV hangs (the outage)', async () => {
    jest.useFakeTimers();
    // Unreachable KV: the command never resolves, mirroring node-redis' offline queue.
    kv.client.fetch.mockReturnValue(new Promise<never>(() => undefined));
    dbWebsite.mockResolvedValue(WEBSITE);

    const pending = fetchWebsite('w1');
    await jest.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual(WEBSITE);
    expect(dbWebsite).toHaveBeenCalledWith('w1');
  });

  test('falls back to the database when KV errors', async () => {
    kv.client.fetch.mockRejectedValue(new Error('ENOTFOUND'));
    dbWebsite.mockResolvedValue(WEBSITE);

    await expect(fetchWebsite('w1')).resolves.toEqual(WEBSITE);
    expect(dbWebsite).toHaveBeenCalledWith('w1');
  });

  test('queries the database directly when KV is disabled', async () => {
    kv.enabled = false;
    dbWebsite.mockResolvedValue(WEBSITE);

    await expect(fetchWebsite('w1')).resolves.toEqual(WEBSITE);
    expect(kv.client.fetch).not.toHaveBeenCalled();
  });

  test('returns null for a soft-deleted website', async () => {
    kv.client.fetch.mockResolvedValue({ id: 'w1', deletedAt: new Date() });

    await expect(fetchWebsite('w1')).resolves.toBeNull();
  });
});

describe('fetchSession', () => {
  test('falls back to the database when KV hangs', async () => {
    jest.useFakeTimers();
    kv.client.fetch.mockReturnValue(new Promise<never>(() => undefined));
    dbSession.mockResolvedValue(SESSION);

    const pending = fetchSession('w1', 's1');
    await jest.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual(SESSION);
    expect(dbSession).toHaveBeenCalledWith('w1', 's1');
  });
});
