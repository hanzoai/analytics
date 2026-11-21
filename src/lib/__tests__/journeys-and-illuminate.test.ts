import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POST as postAst } from '@/app/v1/ast/route';
import { POST as postJourneys } from '@/app/v1/journeys/route';
import {
  buildBranchingJourney,
  computeEffortAnalysis,
  diffAstSnapshots,
  median,
  suggestNextInteractions,
  suggestTopSegments,
} from '@/lib/journeys';

const mk = (session_id: string, names: string[], dwell?: number) =>
  names.map((step, i) => ({ session_id, step, step_index: i + 1, dwell_ms: dwell }));

const steps = [
  ...mk('a', ['home', 'pricing', 'signup']),
  ...mk('b', ['home', 'pricing', 'docs']),
  ...mk('c', ['home', 'docs']),
  ...mk('d', ['home']),
  ...mk('e', ['other', 'pricing']),
];

describe('buildBranchingJourney', () => {
  test('builds branches with conversion and drop-off', () => {
    const t = buildBranchingJourney(steps, 'home', 3);
    expect(t.users).toBe(4);
    expect(t.drop_off_pct).toBe(25);
    expect(t.children.map(c => [c.step, c.users, c.conversion_pct])).toEqual([
      ['pricing', 2, 50],
      ['docs', 1, 25],
    ]);
    expect(t.children[0].children.map(c => c.step).sort()).toEqual(['docs', 'signup']);
    expect(t.children[0].drop_off_pct).toBe(0);
    expect(t.children[0].children[0].drop_off_pct).toBe(100);
  });
  test('respects maxDepth and missing root', () => {
    expect(buildBranchingJourney(steps, 'home', 1).children[0].children).toEqual([]);
    const none = buildBranchingJourney(steps, 'nope', 2);
    expect(none.users).toBe(0);
    expect(none.children).toEqual([]);
  });
});

describe('suggestNextInteractions', () => {
  test('ranks by % did this', () => {
    const r = suggestNextInteractions(steps, 'home');
    expect(r[0]).toMatchObject({ step: 'pricing', users: 2, pct_did_this: 50, pct_dropped_off: 0 });
    expect(r[0].label).toBe('Other interactions after home: pricing');
    expect(r[1]).toMatchObject({ step: 'docs', pct_did_this: 25, pct_dropped_off: 100 });
  });
  test('empty for unknown step', () => {
    expect(suggestNextInteractions(steps, 'zzz')).toEqual([]);
  });
});

describe('computeEffortAnalysis', () => {
  test('median interactions, dwell and revisit', () => {
    const s = [
      { session_id: 'a', step: 'home', step_index: 1, dwell_ms: 100 },
      { session_id: 'a', step: 'x', step_index: 2 },
      { session_id: 'a', step: 'x', step_index: 3 },
      { session_id: 'a', step: 'buy', step_index: 5, dwell_ms: 400 },
      { session_id: 'b', step: 'home', step_index: 1, dwell_ms: 300 },
      { session_id: 'b', step: 'buy', step_index: 2, dwell_ms: 200 },
      { session_id: 'b', step: 'home', step_index: 3 },
    ];
    const r = computeEffortAnalysis(s, ['home', 'buy']);
    expect(r[0]).toMatchObject({
      step: 'home',
      users: 2,
      median_interactions: 0,
      median_dwell_ms: 200,
      revisit_rate: 0.5,
    });
    expect(r[1]).toMatchObject({
      step: 'buy',
      users: 2,
      median_interactions: 2.5,
      median_dwell_ms: 300,
      revisit_rate: 0,
    });
  });
  test('median helper', () => {
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
  });
});

describe('suggestTopSegments', () => {
  const sessions = [
    ...[1, 2, 3, 4].map(i => ({
      session_id: `m${i}`,
      device_class: 'mobile',
      release: 'r1',
      hostname: 'hanzo.ai',
      events: i < 2 ? ['buy'] : [],
    })),
    ...[1, 2, 3, 4].map(i => ({
      session_id: `d${i}`,
      device_class: 'desktop',
      release: 'r1',
      hostname: 'hanzo.ai',
      events: i < 4 ? ['buy'] : [],
    })),
  ];
  test('ranks highest-variance segment first', () => {
    const r = suggestTopSegments(sessions, 'buy');
    expect(r[0].dimension).toBe('device_class');
    expect(r.find(x => x.dimension === 'hostname')?.lift).toBe(0);
    expect(r[0].baseline).toBe(0.5);
    expect(['mobile', 'desktop']).toContain(r[0].value);
  });
  test('empty sessions', () => {
    expect(suggestTopSegments([], 'buy')).toEqual([]);
  });
});

describe('diffAstSnapshots', () => {
  const prev = {
    sections: [
      {
        id: 'hero',
        content: [
          { control_id: 'cta', text: 'Start', href: '/a' },
          { control_id: 'old', text: 'Old' },
        ],
      },
      { id: 'gone', content: [] },
    ],
  };
  const next = {
    sections: [
      {
        id: 'hero',
        content: [
          { control_id: 'cta', text: 'Get started', href: '/a' },
          { control_id: 'new', text: 'New' },
        ],
      },
      { id: 'footer', content: [] },
    ],
  };
  test('detects added/removed/changed', () => {
    const d = diffAstSnapshots(prev, next);
    expect(d.sections).toEqual({ added: ['footer'], removed: ['gone'], changed: ['hero'] });
    expect(d.controls.added).toEqual([{ section: 'hero', control: 'new' }]);
    expect(d.controls.removed).toEqual([{ section: 'hero', control: 'old' }]);
    expect(d.controls.changed).toEqual([{ section: 'hero', control: 'cta', fields: ['text'] }]);
  });
  test('null inputs', () => {
    expect(diffAstSnapshots(null, next).sections.added).toEqual(['hero', 'footer']);
  });
});

describe('endpoints', () => {
  const req = (url: string, body: unknown) =>
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('POST /v1/journeys returns all analyses', async () => {
    const res = await postJourneys(
      req('https://analytics.hanzo.ai/v1/journeys', {
        steps,
        rootStep: 'home',
        funnelSteps: ['home', 'pricing'],
        sessions: [{ session_id: 'a', device_class: 'mobile', events: ['signup'] }],
        targetEvent: 'signup',
      }),
    );
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.journey.users).toBe(4);
    expect(b.next_interactions[0].step).toBe('pricing');
    expect(b.effort).toHaveLength(2);
    expect(b.segments.length).toBeGreaterThan(0);
  });
  test('POST /v1/journeys rejects invalid payload', async () => {
    const res = await postJourneys(req('https://analytics.hanzo.ai/v1/journeys', { steps: 'x' }));
    expect(res.status).toBe(400);
  });
  test('POST /v1/ast returns diff when previous supplied', async () => {
    const res = await postAst(
      req('https://analytics.hanzo.ai/v1/ast', {
        url: 'https://hanzo.ai/pricing',
        release: 'abc123',
        previous: { sections: [{ id: 'hero', content: [] }] },
        sections: [{ id: 'hero', content: [{ control_id: 'cta', text: 'Go' }] }],
      }),
    );
    const b = await res.json();
    expect(b.release).toBe('abc123');
    expect(b.diff.summary.controls_added).toBe(1);
    expect(b.diff.sections.changed).toEqual(['hero']);
  });
});

describe('tracker source', () => {
  const src = readFileSync(join(process.cwd(), 'src/tracker/index.js'), 'utf8');
  test('rage click, scroll depth, enriched AST', () => {
    expect(src).toContain("track('rage_click'");
    expect(src).toContain("track('scroll_depth'");
    expect(src).toContain('[25, 50, 75, 100]');
    expect(src).toContain(
      'route_template: normalizeRouteTemplate(currentUrl),\n      viewport: getViewportBucket(),',
    );
    expect(src).toContain('control_id: resolveControlId(el) || undefined');
    expect(src).toContain('const heatmapsEnabled = attr(`${_data}heatmaps`) !== _false;');
  });
});
