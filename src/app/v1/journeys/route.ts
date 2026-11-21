import { z } from 'zod';
import {
  buildBranchingJourney,
  computeEffortAnalysis,
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

export const journeysSchema = z.object({
  steps: z.array(stepSchema).max(50000),
  rootStep: z.string().min(1).max(200),
  maxDepth: z.number().int().min(1).max(10).optional(),
  afterStep: z.string().max(200).optional(),
  funnelSteps: z.array(z.string().max(200)).max(50).optional(),
  sessions: z.array(sessionSchema).max(50000).optional(),
  targetEvent: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }
  const parsed = journeysSchema.safeParse(raw);
  if (!parsed.success) return badRequest('Invalid journeys payload');
  const d = parsed.data;

  return json({
    ok: true,
    journey: buildBranchingJourney(d.steps, d.rootStep, d.maxDepth ?? 4),
    next_interactions: suggestNextInteractions(d.steps, d.afterStep ?? d.rootStep),
    effort: d.funnelSteps?.length ? computeEffortAnalysis(d.steps, d.funnelSteps) : [],
    segments: d.sessions && d.targetEvent ? suggestTopSegments(d.sessions, d.targetEvent) : [],
  });
}
