import { ok } from '@/lib/response';
import { POST as sendEvent } from '@/app/api/send/route';

/**
 * POST /api/element — Hanzo tracker element interaction endpoint.
 *
 * Receives element click/visibility data from the @hanzo/analytics tracker.
 * Forwards as a custom event to the standard event pipeline.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const websiteId = body?.website;

    if (!websiteId) {
      return ok();
    }

    const eventPayload = {
      type: 'event' as const,
      payload: {
        website: websiteId,
        name: '$element_interaction',
        url: body.url || '/',
        data: {
          elementId: body.elementId || body.id,
          elementTag: body.tag,
          elementText: body.text,
          action: body.action || 'view',
          ...body.data,
        },
      },
    };

    const forwardReq = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(eventPayload),
    });

    return await sendEvent(forwardReq);
  } catch {
    return ok();
  }
}
