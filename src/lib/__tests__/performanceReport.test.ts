import { PERFORMANCE_METRICS } from '@/lib/constants';
import { reportResultSchema } from '@/lib/schema';

// Web Vitals read path: a type:'performance' report must validate and carry its metric
// through (the discriminatedUnion previously had no 'performance' variant → 400 / stripped
// params). metric MUST be an enum allowlist because it is interpolated into raw SQL.

const base = {
  websiteId: '00000000-0000-4000-8000-000000000000',
  filters: {},
};

describe('performance report validation', () => {
  test('accepts a performance report and preserves the metric', () => {
    const result = reportResultSchema.safeParse({
      ...base,
      type: 'performance',
      parameters: {
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-02T00:00:00Z',
        unit: 'day',
        timezone: 'UTC',
        metric: 'inp',
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const body = result.data as { type: string; parameters: { metric: string } };
      expect(body.type).toBe('performance');
      expect(body.parameters.metric).toBe('inp');
    }
  });

  test.each([...PERFORMANCE_METRICS])('accepts valid metric %s', metric => {
    const result = reportResultSchema.safeParse({
      ...base,
      type: 'performance',
      parameters: { startDate: '2026-01-01', endDate: '2026-01-02', metric },
    });
    expect(result.success).toBe(true);
  });

  test('rejects a SQL-injection metric (enum allowlist blocks it)', () => {
    const result = reportResultSchema.safeParse({
      ...base,
      type: 'performance',
      parameters: {
        startDate: '2026-01-01',
        endDate: '2026-01-02',
        metric: 'lcp) as p50, (select password from users)--',
      },
    });
    expect(result.success).toBe(false);
  });
});
