import { buildAggregateHeatmapKey, isHeatmapEligibleRoute } from '@/lib/heatmap';
import { json } from '@/lib/response';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return json({ ok: true });
    }

    const url =
      typeof body.url === 'string'
        ? body.url
        : typeof body.route_template === 'string'
          ? body.route_template
          : '';
    if (url && !isHeatmapEligibleRoute(url)) {
      return json({ ok: true, dropped: true, reason: 'excluded_route' });
    }

    if (body.hostname && (body.control_id || body.elementId || body.elementType)) {
      const key = buildAggregateHeatmapKey({
        hostname: String(body.hostname),
        urlOrPath: url || '/',
        release: typeof body.release === 'string' ? body.release : undefined,
        viewport: body.viewport,
        viewportWidth: typeof body.viewportWidth === 'number' ? body.viewportWidth : undefined,
        control_id: typeof body.control_id === 'string' ? body.control_id : undefined,
        element: {
          tagName: body.elementType,
          id: body.elementId,
          textContent: body.elementText,
          attributes: body.attributes,
        },
      });
      if (!key) {
        return json({ ok: true, dropped: true, reason: 'ineligible_control' });
      }
      return json({ ok: true, key });
    }

    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
}
