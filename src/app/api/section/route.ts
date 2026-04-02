import { ok } from '@/lib/response';
import { POST as sendEvent } from '@/app/api/send/route';

/**
 * POST /api/section — Hanzo tracker section visibility endpoint.
 *
 * Receives section/fold visibility data from the @hanzo/analytics tracker.
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
        name: '$section_view',
        url: body.url || '/',
        data: {
          sectionId: body.sectionId || body.id,
          sectionName: body.name,
          foldIndex: body.foldIndex,
          visiblePercent: body.visiblePercent,
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
