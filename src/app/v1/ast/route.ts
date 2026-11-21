import { z } from 'zod';
import { getAstSnapshot, listAstReleases, saveAstSnapshot } from '@/lib/ast-store';
import { normalizeRouteTemplate } from '@/lib/funnel';
import { isHeatmapEligibleRoute } from '@/lib/heatmap';
import { diffAstSnapshots } from '@/lib/journeys';
import { badRequest, json } from '@/lib/response';

const astSectionSchema = z.object({
  name: z.string().max(200).optional(),
  type: z.string().max(64).optional(),
  id: z.string().max(120).optional(),
  content: z
    .array(
      z.object({
        type: z.string().max(64).optional(),
        text: z.string().max(200).optional(),
        href: z.string().max(500).optional(),
        control_id: z.string().max(160).optional(),
        component_path: z.string().max(240).optional(),
      }),
    )
    .max(50)
    .optional(),
});

const astPayloadSchema = z.object({
  release: z.string().max(120).optional(),
  route_template: z.string().max(500).optional(),
  viewport: z.string().max(32).optional(),
  previous: z.object({ sections: z.array(astSectionSchema).max(100).optional() }).optional(),
  '@context': z.string().optional(),
  '@type': z.string().optional(),
  url: z.string().max(2000).optional(),
  hostname: z.string().max(255).optional(),
  head: z
    .object({
      title: z.string().max(500).optional(),
      description: z.string().max(1000).optional(),
    })
    .optional(),
  sections: z.array(astSectionSchema).max(100).optional(),
  structured: z.array(z.unknown()).max(20).optional(),
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest({ message: 'Invalid JSON body' });
  }

  const parsed = astPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest({ message: 'Invalid AST payload' });
  }

  const data = parsed.data;
  if (
    (data.url && !isHeatmapEligibleRoute(data.url)) ||
    (data.route_template && !isHeatmapEligibleRoute(data.route_template))
  ) {
    return json({ ok: true, dropped: true, reason: 'excluded_ux_route' });
  }

  let hostname = data.hostname || '';
  if (!hostname && data.url) {
    try {
      hostname = new URL(data.url).hostname;
    } catch {
      hostname = '';
    }
  }

  const routeTemplate = data.route_template
    ? normalizeRouteTemplate(data.route_template)
    : normalizeRouteTemplate(data.url || '/');
  const result: Record<string, any> = {
    ok: true,
    hostname,
    route_template: routeTemplate,
    sections: data.sections?.length ?? 0,
  };
  let prevSnapshot = data.previous;
  if (data.release) {
    result.release = data.release;
    const saved = saveAstSnapshot({
      hostname,
      route_template: routeTemplate,
      viewport: data.viewport,
      release: data.release,
      sections: data.sections,
    });
    if (!prevSnapshot && saved.previous) {
      prevSnapshot = { sections: saved.previous.sections };
      result.previous_release = saved.previous.release;
    }
  }
  if (prevSnapshot) {
    const diff = diffAstSnapshots(prevSnapshot, { sections: data.sections });
    result.diff = {
      ...diff,
      summary: {
        sections_added: diff.sections.added.length,
        sections_removed: diff.sections.removed.length,
        sections_changed: diff.sections.changed.length,
        controls_added: diff.controls.added.length,
        controls_removed: diff.controls.removed.length,
        controls_changed: diff.controls.changed.length,
      },
    };
  }
  return json(result);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hostname = searchParams.get('hostname') || undefined;
  const rawRoute = searchParams.get('route_template') || undefined;
  const routeTemplate = rawRoute ? normalizeRouteTemplate(rawRoute) : undefined;
  const viewport = searchParams.get('viewport') || undefined;
  const from = searchParams.get('from') || undefined;
  const to = searchParams.get('to') || undefined;

  if ((from && !to) || (!from && to)) {
    return badRequest({
      message: 'both from and to release parameters are required when comparing releases',
    });
  }

  if (from && to) {
    if (!hostname || !routeTemplate) {
      return badRequest({
        message: 'hostname and route_template are required when comparing releases',
      });
    }
    const prev = getAstSnapshot(hostname, routeTemplate, from, viewport || 'desktop');
    const next = getAstSnapshot(hostname, routeTemplate, to, viewport || 'desktop');
    if (!prev || !next) {
      return json({
        ok: true,
        hostname,
        route_template: routeTemplate,
        from,
        to,
        found: { from: Boolean(prev), to: Boolean(next) },
        diff: null,
      });
    }
    const diff = diffAstSnapshots(prev, next);
    return json({
      ok: true,
      hostname,
      route_template: routeTemplate,
      from,
      to,
      diff: {
        ...diff,
        summary: {
          sections_added: diff.sections.added.length,
          sections_removed: diff.sections.removed.length,
          sections_changed: diff.sections.changed.length,
          controls_added: diff.controls.added.length,
          controls_removed: diff.controls.removed.length,
          controls_changed: diff.controls.changed.length,
        },
      },
    });
  }

  return json({
    ok: true,
    snapshots: listAstReleases({ hostname, route_template: routeTemplate, viewport }),
  });
}
