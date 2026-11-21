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
      let target = hits[0];
      let from: number | undefined;
      if (idx === 0) from = list[0].step_index;
      else {
        const firstPrev = list.find(s => s.step === funnelSteps[idx - 1]);
        if (firstPrev) {
          const hitAfterPrev = hits.find(h => h.step_index >= firstPrev.step_index);
          if (hitAfterPrev) target = hitAfterPrev;
          const prev = list.filter(
            s => s.step === funnelSteps[idx - 1] && s.step_index <= target.step_index,
          );
          if (prev.length) from = prev[prev.length - 1].step_index;
        }
      }
      if (from !== undefined) deltas.push(target.step_index - from);
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

/* ---------------- Deep Intelligence: Release Compare, Rage Clicks, Error Attribution ---------------- */

export interface ReleaseComparison {
  release_a: string;
  release_b: string;
  target_event: string;
  sessions_a: number;
  sessions_b: number;
  rate_a_pct: number;
  rate_b_pct: number;
  delta_pct: number;
  regression: boolean;
}

export function compareReleases(
  sessions: SessionRecord[],
  targetEvent: string,
  releaseA: string,
  releaseB: string,
): ReleaseComparison {
  const a = sessions.filter(s => s.release === releaseA);
  const b = sessions.filter(s => s.release === releaseB);
  const convA = a.filter(s => s.events.includes(targetEvent)).length;
  const convB = b.filter(s => s.events.includes(targetEvent)).length;
  const rateA = pct(convA, a.length);
  const rateB = pct(convB, b.length);
  const delta = round(rateB - rateA, 2);
  return {
    release_a: releaseA,
    release_b: releaseB,
    target_event: targetEvent,
    sessions_a: a.length,
    sessions_b: b.length,
    rate_a_pct: rateA,
    rate_b_pct: rateB,
    delta_pct: delta,
    regression: a.length > 0 && b.length > 0 && delta <= -5,
  };
}

export interface RageClickEvent {
  session_id: string;
  control_id: string;
  component_path?: string;
  route_template?: string;
  release?: string;
}

export interface RageClickAlert {
  control_id: string;
  component_path?: string;
  route_template?: string;
  release?: string;
  events: number;
  sessions: number;
  severity: 'high' | 'medium' | 'low';
}

export function computeRageClickAlerts(events: RageClickEvent[], limit = 20): RageClickAlert[] {
  const groups = new Map<
    string,
    {
      control_id: string;
      component_path?: string;
      route_template?: string;
      release?: string;
      events: number;
      sessions: Set<string>;
    }
  >();
  for (const e of events) {
    if (!e.control_id) continue;
    const key = `${e.control_id}|${e.route_template || ''}|${e.release || ''}`;
    const g = groups.get(key) ?? {
      control_id: e.control_id,
      component_path: e.component_path,
      route_template: e.route_template,
      release: e.release,
      events: 0,
      sessions: new Set<string>(),
    };
    g.events += 1;
    if (e.session_id) g.sessions.add(e.session_id);
    if (!g.component_path && e.component_path) g.component_path = e.component_path;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(g => {
      const sessions = g.sessions.size;
      const severity: RageClickAlert['severity'] =
        sessions >= 10 || g.events >= 25
          ? 'high'
          : sessions >= 3 || g.events >= 8
            ? 'medium'
            : 'low';
      return {
        control_id: g.control_id,
        component_path: g.component_path,
        route_template: g.route_template,
        release: g.release,
        events: g.events,
        sessions,
        severity,
      };
    })
    .sort(
      (a, b) =>
        b.sessions - a.sessions || b.events - a.events || a.control_id.localeCompare(b.control_id),
    )
    .slice(0, limit);
}

export interface CapturedErrorEvent {
  fingerprint?: string;
  error_class?: string;
  error_source?: string;
  message?: string;
  file?: string;
  line?: number;
  column?: number;
  component_path?: string;
  control_id?: string;
  route_template?: string;
  hostname?: string;
  release?: string;
  session_id?: string;
  breadcrumbs?: string;
}

export interface AttributedError {
  fingerprint: string;
  project: string;
  repo: string;
  component: string;
  component_path?: string;
  control_id?: string;
  file?: string;
  line?: number;
  column?: number;
  route_template?: string;
  release?: string;
  error_class: string;
  error_source?: string;
  message: string;
  session_id?: string;
  breadcrumbs?: string;
}

export interface SessionErrorIssue {
  fingerprint: string;
  project: string;
  repo: string;
  component: string;
  component_path?: string;
  control_id?: string;
  file?: string;
  line?: number;
  route_template?: string;
  release?: string;
  error_class: string;
  error_sources: string[];
  message: string;
  occurrences: number;
  session_count: number;
  sessions: string[];
  latest_breadcrumbs?: string;
}

const HOST_REPO_MAP: Record<string, [string, string]> = {
  'insights.hanzo.ai': ['insights', 'hanzoai/insights'],
  'analytics.hanzo.ai': ['analytics', 'hanzoai/analytics'],
  'hanzo.ai': ['ai', 'hanzo-apps/ai'],
  'docs.hanzo.ai': ['docs', 'hanzo-docs/docs'],
  'app.hanzo.ai': ['app', 'hanzo-inc/app'],
  'hanzo.app': ['app', 'hanzo-inc/app'],
  'api.hanzo.ai': ['cloud', 'hanzo-inc/cloud'],
  'platform.hanzo.ai': ['platform', 'hanzo-inc/platform'],
  'console.hanzo.ai': ['platform', 'hanzo-inc/platform'],
  'hanzo.bot': ['bot', 'hanzo-inc/bot'],
};

function normalizeErrorFile(raw?: string): { file?: string; inferredHost?: string } {
  if (!raw) return {};
  let s = raw.trim();
  const qIdx = s.search(/[?#]/);
  if (qIdx >= 0) s = s.slice(0, qIdx);
  let inferredHost: string | undefined;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      inferredHost = u.hostname.toLowerCase();
      s = u.pathname.replace(/^\/+/, '');
    } catch {
      // keep raw without query
    }
  }
  for (const prefix of [
    'webpack-internal:///./',
    'webpack-internal:///',
    'webpack://_N_E/./',
    'webpack://_N_E/',
    'webpack:///./',
    'webpack:///',
    'app:///./',
    'app:///',
    'file://',
  ]) {
    if (s.startsWith(prefix)) s = s.slice(prefix.length);
  }
  s = s.replace(/^\.\//, '');
  return { file: s || undefined, inferredHost };
}

export function attributeErrorEvent(err: CapturedErrorEvent): AttributedError {
  const { file: normalizedFile, inferredHost } = normalizeErrorFile(err.file);
  const host = (err.hostname || inferredHost || '').toLowerCase();
  let [project, repo] = HOST_REPO_MAP[host] ?? [host || 'unknown', ''];
  if (!repo && normalizedFile) {
    const lf = normalizedFile.toLowerCase();
    if (lf.startsWith('products/') || lf.startsWith('frontend/src/scenes/')) {
      [project, repo] = ['insights', 'hanzoai/insights'];
    } else if (lf.startsWith('src/tracker/') || lf.startsWith('src/app/v1/journeys')) {
      [project, repo] = ['analytics', 'hanzoai/analytics'];
    } else if (lf.startsWith('apps/o11y/') || lf.startsWith('apps/event/')) {
      [project, repo] = ['cloud', 'hanzo-inc/cloud'];
    }
  }
  let component = '';
  if (err.component_path) {
    const leaf = err.component_path.split('>').pop()?.trim() || '';
    const match = leaf.match(/\[([^\]]+)\]/);
    component = match ? match[1] : leaf;
  }
  if (!component && normalizedFile) {
    const base = normalizedFile.split('/').pop() || '';
    const stem = base.split('.')[0] || '';
    if (stem && !['index', 'page', 'route', 'main'].includes(stem)) component = stem;
  }
  const errorClass = err.error_class || 'Error';
  const message = (err.message || '').slice(0, 300);
  const msgKey =
    message
      .toLowerCase()
      .replace(/[0-9a-f]{8,}|\d+/g, '#')
      .replace(/[^a-z0-9#]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'unknown';
  const fingerprint =
    err.fingerprint ||
    (normalizedFile || err.line
      ? `${errorClass}:${normalizedFile || err.route_template || 'unknown'}:${err.line || 0}:${component || 'app'}`
      : `${errorClass}:${msgKey}:${err.route_template || component || 'app'}`);
  return {
    fingerprint,
    project,
    repo,
    component: component || project,
    component_path: err.component_path,
    control_id: err.control_id,
    file: normalizedFile,
    line: err.line,
    column: err.column,
    route_template: err.route_template,
    release: err.release,
    error_class: errorClass,
    error_source: err.error_source,
    message,
    session_id: err.session_id,
    breadcrumbs: err.breadcrumbs ? err.breadcrumbs.slice(0, 400) : undefined,
  };
}

export function groupSessionErrors(errors: CapturedErrorEvent[], limit = 100): SessionErrorIssue[] {
  const groups = new Map<
    string,
    {
      base: AttributedError;
      occurrences: number;
      sessions: Set<string>;
      sources: Set<string>;
      latestBreadcrumbs?: string;
    }
  >();
  for (const raw of errors) {
    const attr = attributeErrorEvent(raw);
    const key = `${attr.repo || attr.project}::${attr.fingerprint}::${attr.release || ''}`;
    const existing = groups.get(key);
    if (!existing) {
      const sessions = new Set<string>();
      if (attr.session_id) sessions.add(attr.session_id);
      const sources = new Set<string>();
      if (attr.error_source) sources.add(attr.error_source);
      groups.set(key, {
        base: attr,
        occurrences: 1,
        sessions,
        sources,
        latestBreadcrumbs: attr.breadcrumbs,
      });
    } else {
      existing.occurrences += 1;
      if (attr.session_id) existing.sessions.add(attr.session_id);
      if (attr.error_source) existing.sources.add(attr.error_source);
      if (attr.breadcrumbs) existing.latestBreadcrumbs = attr.breadcrumbs;
    }
  }
  return [...groups.values()]
    .map(g => ({
      fingerprint: g.base.fingerprint,
      project: g.base.project,
      repo: g.base.repo,
      component: g.base.component,
      component_path: g.base.component_path,
      control_id: g.base.control_id,
      file: g.base.file,
      line: g.base.line,
      route_template: g.base.route_template,
      release: g.base.release,
      error_class: g.base.error_class,
      error_sources: [...g.sources].sort(),
      message: g.base.message,
      occurrences: g.occurrences,
      session_count: g.sessions.size,
      sessions: [...g.sessions].slice(0, 50),
      latest_breadcrumbs: g.latestBreadcrumbs,
    }))
    .sort(
      (a, b) =>
        b.session_count - a.session_count ||
        b.occurrences - a.occurrences ||
        a.fingerprint.localeCompare(b.fingerprint),
    )
    .slice(0, limit);
}
