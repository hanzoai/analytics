import { ok } from '@/lib/response';
import { POST as sendEvent } from '@/app/api/send/route';

/**
 * POST /api/ast — Hanzo tracker AST (Abstract Syntax Tree) endpoint.
 *
 * Receives page structure/component data from the @hanzo/analytics tracker.
 * Forwards as a custom event to the standard event pipeline for persistence.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const websiteId = body?.website;

    if (!websiteId) {
      // No website context — accept silently for backward compatibility
      return ok();
    }

    // Forward as a custom event to the standard ingestion pipeline
    const eventPayload = {
      type: 'event' as const,
      payload: {
        website: websiteId,
        name: '$ast_snapshot',
        url: body.url || '/',
        data: body.data || body,
      },
    };

    const forwardReq = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(eventPayload),
    });

    return await sendEvent(forwardReq);
  } catch {
    // Accept silently — tracker should never block the page
    return ok();
  }
}
