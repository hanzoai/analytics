/**
 * Commerce API billing integration.
 *
 * Reports per-team (org) event usage to the Commerce API for billing.
 *
 * Configuration via environment variables:
 *   COMMERCE_API_URL  -- Commerce API base URL (e.g. http://commerce.hanzo.svc:8001)
 *   COMMERCE_TOKEN    -- Inter-service auth token for Commerce API
 */

const COMMERCE_API_URL = process.env.COMMERCE_API_URL || '';
const COMMERCE_TOKEN = process.env.COMMERCE_TOKEN || '';

export function isCommerceEnabled(): boolean {
  return !!(COMMERCE_API_URL && COMMERCE_TOKEN);
}

interface UsageRecord {
  organization_id: string;
  organization_slug: string;
  metric: string;
  quantity: number;
}

interface UsagePayload {
  product: string;
  period_start: string;
  period_end: string;
  records: UsageRecord[];
}

/**
 * Report usage records to Commerce API.
 *
 * @returns true if the report was accepted, false otherwise.
 */
export async function reportUsage(payload: UsagePayload): Promise<boolean> {
  if (!isCommerceEnabled()) {
    return false;
  }

  try {
    const res = await fetch(`${COMMERCE_API_URL}/api/v1/usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${COMMERCE_TOKEN}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    return res.ok;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[commerce] Failed to report usage:', err);
    return false;
  }
}
