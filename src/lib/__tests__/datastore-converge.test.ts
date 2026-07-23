/**
 * Convergence guard: one OLAP backend, one env var (DATASTORE_URL), one dispatch
 * key (DATASTORE). Proves the split-brain is closed — a query object keyed only
 * for the OLAP path routes to [DATASTORE] under DATASTORE_URL (previously an
 * un-dispatched [CLICKHOUSE] key threw TypeError 500), and the single client
 * carries the superset query-builder semantics (IN-array equality, OR matching,
 * excludeBounce) the report/performance/replay tabs depend on.
 */
import * as db from '@/lib/db';
import { DATASTORE, KAFKA, PRISMA, runQuery } from '@/lib/db';
import datastore from '@/lib/datastore';
import { OPERATORS } from '@/lib/constants';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('runQuery dispatch — one OLAP switch', () => {
  test('DATASTORE_URL routes the OLAP path to [DATASTORE]', async () => {
    process.env.DATASTORE_URL = 'http://u:p@datastore.hanzo.svc.cluster.local:8123/analytics';
    delete process.env.DATABASE_URL;

    const seen: string[] = [];
    const out = await runQuery({
      [PRISMA]: () => {
        seen.push('prisma');
        return 'prisma';
      },
      [DATASTORE]: () => {
        seen.push('datastore');
        return 'datastore';
      },
    });

    expect(out).toBe('datastore');
    expect(seen).toEqual(['datastore']);
  });

  test('KAFKA still wins over DATASTORE when a query defines it', async () => {
    process.env.DATASTORE_URL = 'http://u:p@datastore.hanzo.svc.cluster.local:8123/analytics';

    const out = await runQuery({
      [KAFKA]: () => 'kafka',
      [DATASTORE]: () => 'datastore',
    });

    expect(out).toBe('kafka');
  });

  test('no DATASTORE_URL + postgres DATABASE_URL falls back to [PRISMA]', async () => {
    delete process.env.DATASTORE_URL;
    process.env.DATABASE_URL = 'postgresql://u:p@sql.hanzo.svc:5432/analytics';

    const out = await runQuery({
      [PRISMA]: () => 'prisma',
      [DATASTORE]: () => 'datastore',
    });

    expect(out).toBe('prisma');
  });

  test('the CLICKHOUSE symbol and its second env switch are gone', () => {
    // One way only: no vestigial CLICKHOUSE key, no CLICKHOUSE_URL branch.
    expect((db as any).CLICKHOUSE).toBeUndefined();
  });
});

describe('single client carries the superset query-builder semantics', () => {
  const websiteId = '2f72b944-f1f8-4d2d-8f6c-26063bde0d1a';

  test('equality compiles to IN Array and params are array-wrapped (matched pair)', () => {
    const { filterQuery, queryParams } = datastore.parseFilters({
      websiteId,
      path: '/pricing',
    });

    // column resolves via FILTER_COLUMNS.path = url_path; placeholder keyed by the filter name
    expect(filterQuery).toContain('url_path IN {path:Array(String)}');
    // param wrapped to an array so it binds the Array(String) placeholder
    expect(Array.isArray((queryParams as any).path)).toBe(true);
    expect((queryParams as any).path).toEqual(['/pricing']);
  });

  test('match=any produces an OR group (feature the report tabs rely on)', () => {
    const { filterQuery } = datastore.parseFilters({
      websiteId,
      match: 'any',
      path: '/a',
      browser: 'chrome',
    });

    expect(filterQuery).toContain('and (');
    expect(filterQuery).toContain('or ');
  });

  test('excludeBounce is emitted only when requested (additive, inert by default)', () => {
    const off = datastore.parseFilters({ websiteId });
    expect(off.excludeBounceQuery).toBe('');

    const on = datastore.parseFilters({ websiteId, excludeBounce: true });
    expect(on.excludeBounceQuery).toContain('website_event_stats_hourly');
    expect(on.excludeBounceQuery).toContain('having sum(views) > 1');
  });

  test('contains still maps to positionCaseInsensitive (unchanged path)', () => {
    // wire form: "<operator>.<value>" — c = contains
    const { filterQuery } = datastore.parseFilters({
      websiteId,
      path: `${OPERATORS.contains}.pricing`,
    });

    expect(filterQuery).toContain('positionCaseInsensitive(url_path, {path:String}) > 0');
  });
});
