import { subMinutes } from 'date-fns';
import datastore from '@/lib/datastore';
import { DATASTORE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';

const FUNCTION_NAME = 'getActiveVisitors';

export async function getActiveVisitors(...args: [websiteId: string]) {
  return runQuery({
    [PRISMA]: () => relationalQuery(...args),
    [DATASTORE]: () => datastoreQuery(...args),
  });
}

async function relationalQuery(websiteId: string) {
  const { rawQuery } = prisma;
  const startDate = subMinutes(new Date(), 5);

  const result = await rawQuery(
    `
    select count(distinct session_id) as "visitors"
    from website_event
    where website_id = {{websiteId::uuid}}
    and created_at >= {{startDate}}
    `,
    { websiteId, startDate },
    FUNCTION_NAME,
  );

  return result?.[0] ?? null;
}

async function datastoreQuery(websiteId: string): Promise<{ x: number }> {
  const { rawQuery } = datastore;
  const startDate = subMinutes(new Date(), 5);

  const result = await rawQuery(
    `
    select
      count(distinct session_id) as "visitors"
    from website_event
    where website_id = {websiteId:UUID}
      and created_at >= {startDate:DateTime64}
    `,
    { websiteId, startDate },
    FUNCTION_NAME,
  );

  return result[0] ?? null;
}
