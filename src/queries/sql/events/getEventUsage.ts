import datastore from '@/lib/datastore';
import { DATASTORE, notImplemented, PRISMA, runQuery } from '@/lib/db';
import type { QueryFilters } from '@/lib/types';

const FUNCTION_NAME = 'getEventUsage';

export function getEventUsage(...args: [websiteIds: string[], filters: QueryFilters]) {
  return runQuery({
    [PRISMA]: notImplemented,
    [DATASTORE]: () => datastoreQuery(...args),
  });
}

function datastoreQuery(
  websiteIds: string[],
  filters: QueryFilters,
): Promise<{ websiteId: string; count: number }[]> {
  const { rawQuery } = datastore;
  const { startDate, endDate } = filters;

  return rawQuery(
    `
    select 
      website_id as websiteId,
      count(*) as count
    from website_event 
    where website_id in {websiteIds:Array(UUID)}
      and created_at between {startDate:DateTime64} and {endDate:DateTime64}
    group by website_id
    `,
    {
      websiteIds,
      startDate,
      endDate,
    },
    FUNCTION_NAME,
  );
}
