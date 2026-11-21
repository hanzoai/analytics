import { z } from 'zod';
import { normalizeRouteTemplate } from '@/lib/funnel';
import { isHeatmapEligibleRoute } from '@/lib/heatmap';
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
    return badRequest('Invalid JSON body');
  }

  const parsed = astPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest('Invalid AST payload');
  }

  const data = parsed.data;
  if (data.url && !isHeatmapEligibleRoute(data.url)) {
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

  return json({
    ok: true,
    hostname,
    route_template: normalizeRouteTemplate(data.url || '/'),
    sections: data.sections?.length ?? 0,
  });
}
