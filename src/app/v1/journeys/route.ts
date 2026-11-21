import { z } from 'zod';
import {
  attributeErrorEvent,
  buildBranchingJourney,
  compareReleases,
  computeEffortAnalysis,
  computeRageClickAlerts,
  groupSessionErrors,
  suggestNextInteractions,
  suggestTopSegments,
} from '@/lib/journeys';
import { badRequest, json } from '@/lib/response';

const stepSchema = z.object({
  session_id: z.string().min(1).max(200),
  step: z.string().min(1).max(200),
  step_index: z.number().int().min(0),
  dwell_ms: z.number().min(0).optional(),
});

const sessionSchema = z.object({
  session_id: z.string().min(1).max(200),
  device_class: z.string().max(32).optional(),
  release: z.string().max(120).optional(),
  referrer: z.string().max(500).optional(),
  hostname: z.string().max(255).optional(),
  events: z.array(z.string().max(200)).max(1000),
});

const rageClickSchema = z.object({
  session_id: z.string().min(1).max(200),
  control_id: z.string().min(1).max(200),
  component_path: z.string().max(300).optional(),
  route_template: z.string().max(500).optional(),
  release: z.string().max(120).optional(),
});

const errorEventSchema = z.object({
  fingerprint: z.string().max(200).optional(),
  error_class: z.string().max(120).optional(),
  error_source: z.string().max(64).optional(),
  message: z.string().max(500).optional(),
  file: z.string().max(500).optional(),
  line: z.number().int().min(0).optional(),
  column: z.number().int().min(0).optional(),
  component_path: z.string().max(300).optional(),
  control_id: z.string().max(200).optional(),
  route_template: z.string().max(500).optional(),
  hostname: z.string().max(255).optional(),
  release: z.string().max(120).optional(),
  session_id: z.string().max(200).optional(),
  breadcrumbs: z.string().max(500).optional(),
});

export const journeysSchema = z.object({
  steps: z.array(stepSchema).max(50000),
  rootStep: z.string().min(1).max(200),
  maxDepth: z.number().int().min(1).max(10).optional(),
  afterStep: z.string().max(200).optional(),
  funnelSteps: z.array(z.string().max(200)).max(50).optional(),
  sessions: z.array(sessionSchema).max(50000).optional(),
  targetEvent: z.string().max(200).optional(),
  releaseA: z.string().max(120).optional(),
  releaseB: z.string().max(120).optional(),
  rageClicks: z.array(rageClickSchema).max(50000).optional(),
  errors: z.array(errorEventSchema).max(5000).optional(),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest({ message: 'Invalid JSON body' });
  }
  const parsed = journeysSchema.safeParse(raw);
  if (!parsed.success) return badRequest({ message: 'Invalid journeys payload' });
  const d = parsed.data;

  const response: Record<string, unknown> = {
    ok: true,
    journey: buildBranchingJourney(d.steps, d.rootStep, d.maxDepth ?? 4),
    next_interactions: suggestNextInteractions(d.steps, d.afterStep ?? d.rootStep),
    effort: d.funnelSteps?.length ? computeEffortAnalysis(d.steps, d.funnelSteps) : [],
    segments: d.sessions && d.targetEvent ? suggestTopSegments(d.sessions, d.targetEvent) : [],
  };

  if (d.sessions && d.targetEvent && d.releaseA && d.releaseB) {
    response.release_comparison = compareReleases(
      d.sessions,
      d.targetEvent,
      d.releaseA,
      d.releaseB,
    );
  }
  if (d.rageClicks?.length) {
    response.rage_click_alerts = computeRageClickAlerts(d.rageClicks);
  }
  if (d.errors?.length) {
    response.attributed_errors = d.errors.map(attributeErrorEvent);
    response.session_error_issues = groupSessionErrors(d.errors);
  }

  return json(response);
}
