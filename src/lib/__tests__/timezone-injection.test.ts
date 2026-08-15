/**
 * `timezone` reaches SQL in a position no bound parameter can occupy.
 *
 * getRequestDateRange reads two sibling values out of caller input one line
 * apart: `unit` is checked against getAllowedUnits(), `timezone` used to be
 * returned verbatim. Both are interpolated into SQL — `unit` inside
 * date_trunc(), `timezone` inside `at time zone '…'` — so returning timezone
 * verbatim let a caller close the literal and append a scalar subquery:
 *
 *   ?timezone=utc'||(select/**\/password/**\/from/**\/"user"/**\/limit/**\/1)||'
 *
 * Reachable two ways: GET /api/realtime/{websiteId} calls parseRequest with no
 * zod schema at all, and retention/revenue report parameters declared timezone
 * as a bare z.string() while dateRangeParams used the refined timezoneParam.
 *
 * These assert on the EMITTED SQL, not on the guard.
 */

// The query modules build a client at import time. Seed the module-level
// singletons with capture stubs first so nothing dials a database.
const emitted: string[] = [];

(globalThis as any).prisma = {
  $queryRawUnsafe: (sql: string) => {
    emitted.push(sql);
    return Promise.resolve([]);
  },
  $executeRawUnsafe: () => Promise.resolve(0),
};

(globalThis as any).datastore = {
  query: ({ query }: { query: string }) => {
    emitted.push(query);
    return Promise.resolve({ json: () => Promise.resolve([]) });
  },
};

process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/analytics';
// datastore.ts latches `enabled` at import time; runQuery re-reads the env per
// call, so beforeEach clears it and only the clickhouse case puts it back.
process.env.DATASTORE_URL = 'http://u:p@localhost:8123/analytics';

// Not installed in this workspace; auth plays no part in query construction.
jest.mock('@hanzo/iam', () => ({ validateToken: () => null }), { virtual: true });
// The generated client is ESM (import.meta) and is never constructed here —
// prisma.ts picks up the globalThis singleton seeded above.
jest.mock('@/generated/prisma/client', () => ({ PrismaClient: class {} }), { virtual: true });
// ESM-only dependency pulled in transitively via lib/kafka.ts.
jest.mock('serialize-error', () => ({ serializeError: (e: unknown) => e }), { virtual: true });

/* eslint-disable @typescript-eslint/no-var-requires */
const { getRequestDateRange } = require('@/lib/request');
const { retentionReportSchema, revenueReportSchema } = require('@/lib/schema');
const { getPageviewStats } = require('@/queries/sql/pageviews/getPageviewStats');
const { getRetention } = require('@/queries/sql/reports/getRetention');
/* eslint-enable @typescript-eslint/no-var-requires */

// Closes `at time zone '<HERE>'` and appends a scalar subquery. Lowercase and
// /**/ for whitespace so nothing is lost to case folding or space stripping.
const PAYLOAD = `utc'||(select/**/password/**/from/**/"user"/**/limit/**/1)||'`;
const WEBSITE_ID = '018f0000-0000-7000-8000-000000000000';

beforeEach(() => {
  emitted.length = 0;
  delete process.env.DATASTORE_URL;
});

describe('timezone cannot reach an interpolated SQL literal', () => {
  test('getRequestDateRange allow-lists timezone the same way it allow-lists unit', () => {
    const range = getRequestDateRange({
      startAt: '0',
      endAt: '86400000',
      unit: `day'||(select/**/1)||'`,
      timezone: PAYLOAD,
    });

    expect(range.unit).not.toContain('select');
    expect(range.timezone).toBeUndefined();
  });

  test('a real IANA zone still passes through, normalized', () => {
    expect(
      getRequestDateRange({ startAt: '0', endAt: '86400000', timezone: 'Asia/Calcutta' }).timezone,
    ).toBe('Asia/Kolkata');
    expect(
      getRequestDateRange({ startAt: '0', endAt: '86400000', timezone: 'America/New_York' })
        .timezone,
    ).toBe('America/New_York');
  });

  test('GET /api/realtime/{websiteId}?timezone= does not reach postgres date SQL', async () => {
    // The realtime route calls parseRequest(request) with NO zod schema, so
    // `query` is the raw searchParams object — this is the only gate.
    const filters = getRequestDateRange({ startAt: '0', endAt: '86400000', timezone: PAYLOAD });

    await getPageviewStats(WEBSITE_ID, filters as any);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).not.toContain('select/**/password');
    expect(emitted[0]).not.toContain('at time zone');
  });

  test('GET /api/realtime/{websiteId}?timezone= does not reach clickhouse date SQL', async () => {
    process.env.DATASTORE_URL = 'http://u:p@localhost:8123/analytics';

    const filters = getRequestDateRange({ startAt: '0', endAt: '86400000', timezone: PAYLOAD });

    await getPageviewStats(WEBSITE_ID, filters as any);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).not.toContain('select/**/password');
  });

  test('POST /api/reports/retention rejects an unparseable parameters.timezone', async () => {
    const parsed = retentionReportSchema.safeParse({
      type: 'retention',
      parameters: {
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-02T00:00:00Z',
        timezone: PAYLOAD,
      },
    });

    expect(parsed.success).toBe(false);

    // And the legitimate shape still parses and still reaches SQL as a zone.
    const ok = retentionReportSchema.safeParse({
      type: 'retention',
      parameters: {
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-02T00:00:00Z',
        timezone: 'America/New_York',
      },
    });
    expect(ok.success).toBe(true);

    await getRetention(WEBSITE_ID, ok.data.parameters, {} as any);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain(`at time zone 'America/New_York'`);
    expect(emitted[0]).not.toContain('select/**/password');
  });

  test('POST /api/reports/revenue rejects an unparseable parameters.timezone', () => {
    const parsed = revenueReportSchema.safeParse({
      type: 'revenue',
      parameters: {
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-02T00:00:00Z',
        currency: 'usd',
        timezone: PAYLOAD,
      },
    });

    expect(parsed.success).toBe(false);
  });
});
