/**
 * Server-side event forwarder: Analytics -> Insights.
 *
 * Forwards analytics events to the Insights capture endpoint so they appear
 * in product analytics (funnels, cohorts, feature flags, etc.).
 *
 * Configuration via environment variables:
 *   INSIGHTS_HOST     -- Insights capture endpoint (e.g. http://insights-capture.hanzo.svc:3000)
 *   INSIGHTS_API_KEY  -- Insights project API key
 *
 * Events are sent asynchronously (fire-and-forget) to avoid adding latency
 * to the analytics collection path.
 */

const INSIGHTS_HOST = process.env.INSIGHTS_HOST || '';
const INSIGHTS_API_KEY = process.env.INSIGHTS_API_KEY || '';

/** Whether Insights forwarding is configured. */
export function isInsightsForwardingEnabled(): boolean {
  return !!(INSIGHTS_HOST && INSIGHTS_API_KEY);
}

/** Event payload sent to Insights capture endpoint. */
interface InsightsEvent {
  event: string;
  distinct_id: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Forward an analytics event to Insights.
 *
 * This is fire-and-forget: errors are logged but do not affect the caller.
 * The Insights capture endpoint accepts batched events at POST /batch/.
 */
export function forwardToInsights(event: InsightsEvent): void {
  if (!isInsightsForwardingEnabled()) {
    return;
  }

  const body = JSON.stringify([
    {
      api_key: INSIGHTS_API_KEY,
      event: event.event,
      distinct_id: event.distinct_id,
      properties: {
        ...event.properties,
        $lib: 'hanzo-analytics',
      },
      timestamp: event.timestamp || new Date().toISOString(),
    },
  ]);

  // Fire and forget -- do not await
  fetch(`${INSIGHTS_HOST}/batch/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(5000),
  }).catch(err => {
    // eslint-disable-next-line no-console
    console.warn('[insights-forward] Failed to forward event:', err.message);
  });
}
