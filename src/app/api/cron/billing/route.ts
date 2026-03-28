/**
 * GET /api/cron/billing
 *
 * Periodic usage reporting to Commerce API.
 * Reports per-team pageview/event counts for the previous hour.
 *
 * This endpoint is intended to be called by a K8s CronJob or external scheduler.
 * It requires the APP_SECRET as x-cron-secret header or Bearer token for auth.
 */
import { NextResponse } from 'next/server';
import { isCommerceEnabled, reportUsage } from '@/lib/commerce';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Verify cron auth -- require APP_SECRET as bearer token
  const appSecret = process.env.APP_SECRET || '';
  const authHeader = request.headers.get('authorization') || '';
  const cronSecret = request.headers.get('x-cron-secret') || '';

  if (!appSecret || (authHeader !== `Bearer ${appSecret}` && cronSecret !== appSecret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!isCommerceEnabled()) {
    return NextResponse.json({ status: 'skipped', reason: 'commerce not configured' });
  }

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMinutes(0, 0, 0);
  const periodStart = new Date(periodEnd.getTime() - 3600000); // 1 hour ago

  try {
    const { client } = prisma;

    // Count events per team in the last hour using raw SQL for reliability
    const rows: Array<{ team_id: string; team_name: string; cnt: bigint }> = await client.$queryRaw`
        SELECT w.team_id, t.name AS team_name, COUNT(*) AS cnt
        FROM website_event e
        JOIN website w ON w.website_id = e.website_id
        JOIN team t ON t.team_id = w.team_id
        WHERE e.created_at >= ${periodStart}
          AND e.created_at < ${periodEnd}
          AND w.team_id IS NOT NULL
        GROUP BY w.team_id, t.name
      `;

    if (!rows || rows.length === 0) {
      return NextResponse.json({ status: 'ok', events: 0 });
    }

    const records = rows.map(row => ({
      organization_id: row.team_id,
      organization_slug: row.team_name.toLowerCase().replace(/\s+/g, '-'),
      metric: 'events_ingested' as const,
      quantity: Number(row.cnt),
    }));

    const success = await reportUsage({
      product: 'analytics',
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      records,
    });

    return NextResponse.json({
      status: success ? 'ok' : 'error',
      teams: records.length,
      total_events: records.reduce((sum, r) => sum + r.quantity, 0),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[cron/billing] Error:', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
