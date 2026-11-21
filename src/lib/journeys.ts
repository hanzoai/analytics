/**
 * Pure journey / Illuminate algorithms: branching journeys, next-interaction
 * suggestions, effort analysis, segment suggestions and AST release diffs.
 */

export interface JourneyStep {
  session_id: string;
  step: string;
  step_index: number;
  dwell_ms?: number;
}

export interface JourneyNode {
  step: string;
  users: number;
  conversion_pct: number; // % of root users that reached this node
  drop_off_pct: number; // % of this node's users with no further step
  children: JourneyNode[];
}

export interface NextInteraction {
  step: string;
  label: string;
  users: number;
  pct_did_this: number;
  pct_dropped_off: number;
}

export interface EffortRow {
  step: string;
  users: number;
  median_interactions: number;
  median_dwell_ms: number;
  revisit_rate: number;
}

export interface SessionRecord {
  session_id: string;
  device_class?: string;
  release?: string;
  referrer?: string;
  hostname?: string;
  events: string[];
}

export interface SegmentSuggestion {
  dimension: string;
  value: string;
  sessions: number;
  rate: number;
  baseline: number;
  lift: number;
  score: number;
}

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
const pct = (n: number, d: number) => (d > 0 ? round((n / d) * 100) : 0);

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function groupSessions(steps: JourneyStep[]): Map<string, JourneyStep[]> {
  const map = new Map<string, JourneyStep[]>();
  for (const s of steps) {
    const list = map.get(s.session_id) ?? [];
    list.push(s);
    map.set(s.session_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.step_index - b.step_index);
  return map;
}

export function buildBranchingJourney(
  steps: JourneyStep[],
  rootStep: string,
  maxDepth = 4,
): JourneyNode {
  // Path per session starting at first occurrence of the root.
  const paths: string[][] = [];
  for (const list of groupSessions(steps).values()) {
    const names = list.map(s => s.step);
    const i = names.indexOf(rootStep);
    if (i >= 0) paths.push(names.slice(i));
  }
  const rootUsers = paths.length;

  const build = (group: string[][], depth: number, step: string): JourneyNode => {
    const ending = group.filter(p => p.length <= depth + 1).length;
    const node: JourneyNode = {
      step,
      users: group.length,
      conversion_pct: pct(group.length, rootUsers),
      drop_off_pct: pct(ending, group.length),
      children: [],
    };
    if (depth >= maxDepth) {
      node.drop_off_pct = pct(group.filter(p => p.length <= depth + 1).length, group.length);
      return node;
    }
    const next = new Map<string, string[][]>();
    for (const p of group) {
      if (p.length > depth + 1) {
        const l = next.get(p[depth + 1]) ?? [];
        l.push(p);
        next.set(p[depth + 1], l);
      }
    }
    node.children = [...next.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([name, g]) => build(g, depth + 1, name));
    return node;
  };

  return build(paths, 0, rootStep);
}

export function suggestNextInteractions(
  steps: JourneyStep[],
  afterStep: string,
): NextInteraction[] {
  let total = 0;
  const next = new Map<string, { users: number; dropped: number }>();
  for (const list of groupSessions(steps).values()) {
    const i = list.findIndex(s => s.step === afterStep);
    if (i < 0) continue;
    total += 1;
    const n = list[i + 1];
    if (!n) continue;
    const entry = next.get(n.step) ?? { users: 0, dropped: 0 };
    entry.users += 1;
    if (i + 2 >= list.length) entry.dropped += 1;
    next.set(n.step, entry);
  }
  return [...next.entries()]
    .map(([step, v]) => ({
      step,
      label: `Other interactions after ${afterStep}: ${step}`,
      users: v.users,
      pct_did_this: pct(v.users, total),
      pct_dropped_off: pct(v.dropped, v.users),
    }))
    .sort(
      (a, b) =>
        b.pct_did_this - a.pct_did_this ||
        b.pct_dropped_off - a.pct_dropped_off ||
        a.step.localeCompare(b.step),
    );
}

export function computeEffortAnalysis(steps: JourneyStep[], funnelSteps: string[]): EffortRow[] {
  const sessions = [...groupSessions(steps).values()];
  return funnelSteps.map((name, idx) => {
    const deltas: number[] = [];
    const dwells: number[] = [];
    let users = 0;
    let revisits = 0;
    for (const list of sessions) {
      const hits = list.filter(s => s.step === name);
      if (!hits.length) continue;
      users += 1;
      if (hits.length > 1) revisits += 1;
      const first = hits[0];
      let from: number | undefined;
      if (idx === 0) from = list[0].step_index;
      else {
        const prev = list.filter(
          s => s.step === funnelSteps[idx - 1] && s.step_index <= first.step_index,
        );
        if (prev.length) from = prev[0].step_index;
      }
      if (from !== undefined) deltas.push(first.step_index - from);
      for (const h of hits) if (typeof h.dwell_ms === 'number') dwells.push(h.dwell_ms);
    }
    return {
      step: name,
      users,
      median_interactions: median(deltas),
      median_dwell_ms: median(dwells),
      revisit_rate: users ? round(revisits / users, 4) : 0,
    };
  });
}

const SEGMENT_DIMENSIONS = ['device_class', 'release', 'referrer', 'hostname'] as const;

export function suggestTopSegments(
  sessions: SessionRecord[],
  targetEvent: string,
  limit = 10,
): SegmentSuggestion[] {
  if (!sessions.length) return [];
  const converted = (s: SessionRecord) => s.events.includes(targetEvent);
  const baseline = sessions.filter(converted).length / sessions.length;
  const out: SegmentSuggestion[] = [];
  for (const dim of SEGMENT_DIMENSIONS) {
    const groups = new Map<string, SessionRecord[]>();
    for (const s of sessions) {
      const v = s[dim];
      if (!v) continue;
      const l = groups.get(v) ?? [];
      l.push(s);
      groups.set(v, l);
    }
    for (const [value, g] of groups) {
      const rate = g.filter(converted).length / g.length;
      const lift = rate - baseline;
      out.push({
        dimension: dim,
        value,
        sessions: g.length,
        rate: round(rate, 4),
        baseline: round(baseline, 4),
        lift: round(lift, 4),
        score: round(Math.abs(lift) * Math.sqrt(g.length), 4),
      });
    }
  }
  return out
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.dimension.localeCompare(b.dimension) ||
        a.value.localeCompare(b.value),
    )
    .slice(0, limit);
}

/* ---------------- AST diff ---------------- */

export interface AstControl {
  type?: string;
  text?: string;
  href?: string;
  control_id?: string;
  component_path?: string;
}
export interface AstSection {
  name?: string;
  type?: string;
  id?: string;
  content?: AstControl[];
}
export interface AstSnapshot {
  sections?: AstSection[];
}

export interface AstDiff {
  sections: { added: string[]; removed: string[]; changed: string[] };
  controls: {
    added: { section: string; control: string }[];
    removed: { section: string; control: string }[];
    changed: { section: string; control: string; fields: string[] }[];
  };
}

const sectionKey = (s: AstSection, i: number) => s.id || s.name || `${s.type || 'section'}#${i}`;
const controlKey = (c: AstControl, i: number) =>
  c.control_id || `${c.type || 'el'}:${c.text || ''}:${c.href || ''}` || `#${i}`;

export function diffAstSnapshots(
  prevAst: AstSnapshot | null | undefined,
  nextAst: AstSnapshot | null | undefined,
): AstDiff {
  const index = (ast?: AstSnapshot | null) => {
    const m = new Map<string, Map<string, AstControl>>();
    (ast?.sections ?? []).forEach((s, i) => {
      const cm = new Map<string, AstControl>();
      (s.content ?? []).forEach((c, j) => {
        cm.set(controlKey(c, j), c);
      });
      m.set(sectionKey(s, i), cm);
    });
    return m;
  };
  const a = index(prevAst);
  const b = index(nextAst);
  const diff: AstDiff = {
    sections: { added: [], removed: [], changed: [] },
    controls: { added: [], removed: [], changed: [] },
  };
  for (const k of b.keys()) if (!a.has(k)) diff.sections.added.push(k);
  for (const k of a.keys()) if (!b.has(k)) diff.sections.removed.push(k);
  for (const [sk, nc] of b) {
    const pc = a.get(sk);
    if (!pc) continue;
    let touched = false;
    for (const [ck, c] of nc) {
      const p = pc.get(ck);
      if (!p) {
        diff.controls.added.push({ section: sk, control: ck });
        touched = true;
        continue;
      }
      const fields = (['text', 'href', 'component_path', 'type'] as const).filter(
        f => (p[f] || '') !== (c[f] || ''),
      );
      if (fields.length) {
        diff.controls.changed.push({ section: sk, control: ck, fields });
        touched = true;
      }
    }
    for (const ck of pc.keys()) {
      if (!nc.has(ck)) {
        diff.controls.removed.push({ section: sk, control: ck });
        touched = true;
      }
    }
    if (touched) diff.sections.changed.push(sk);
  }
  return diff;
}
