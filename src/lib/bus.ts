/**
 * The bus is how analytics hears about a visit.
 *
 * Every site posts its events to api.hanzo.ai /v1/event, the one ingest. Cloud
 * lands each on its EVENT stream, and this durable consumer reads the `act`
 * facts there (subject event.act), the same way cloud's insights bridge does.
 * Nothing posts to analytics as a destination.
 *
 * One act fact becomes one website_event: a `page` fact a pageview, a `track`
 * fact with a plain name a custom event, on the website of the cloud project whose
 * key admitted it (src/lib/project.ts). A project's website is created the first
 * time its facts arrive, in its org's team; /v1/pixels renames and retires them
 * from cloud's /v1/projects. The visitor is the fact's anonymous_id, else its
 * distinct_id, and the session is derived from it exactly as /v1/send derives one
 * from `id`.
 *
 * What the stamp at ingest names is read, never re-derived from a request this
 * process did not see: attributes.user_agent, attributes.country,
 * attributes.screen, attributes.language, and the top-level ip, which cloud
 * carries on the bus message and never writes to a table.
 */
import debug from 'debug';
import { AckPolicy, connect, DeliverPolicy, type JetStreamManager, type JsMsg } from 'nats';
import { getLocation } from '@/lib/detect';
import { ensureOrgTeam } from '@/lib/iam-org';
import prisma from '@/lib/prisma';
import { type Fact, type Site, visitOf } from '@/lib/visit';
import { createSession, saveEvent } from '@/queries/sql';

const log = debug('hanzo:analytics:bus');

export const STREAM = 'EVENT';
export const SUBJECT = 'event.act';
export const DURABLE = 'analytics';

const known = new Set<string>();

/**
 * The project's website, created the first time the project's facts arrive and
 * restored if it was retired, since a fact means its key still resolves.
 */
async function ensureWebsite(site: Site) {
  if (known.has(site.id)) return;
  const teamId = await ensureOrgTeam(site.org);
  await prisma.client.website.upsert({
    where: { id: site.id },
    create: { id: site.id, name: site.slug, domain: site.host || null, teamId },
    update: { deletedAt: null },
  });
  known.add(site.id);
}

/** A duplicate key is a redelivered fact that already landed. */
function landed(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

/** Store one fact. Resolves when it is stored, or when it is not a visit. */
export async function land(f: Fact): Promise<boolean> {
  const v = visitOf(f);
  if (!v) return false;
  await ensureWebsite(v.site);
  if (v.ip) {
    const place = await getLocation(v.ip, new Headers(), true).catch(() => null);
    if (place) {
      v.session.country = v.session.country || place.country;
      v.session.region = place.region;
      v.session.city = place.city;
      v.event.country = v.session.country;
      v.event.region = place.region;
      v.event.city = place.city;
    }
  }
  await createSession(v.session);
  try {
    await saveEvent(v.event);
  } catch (err) {
    if (!landed(err)) throw err;
  }
  return true;
}

async function durable(jsm: JetStreamManager) {
  try {
    await jsm.consumers.info(STREAM, DURABLE);
  } catch {
    // First run: read everything the stream still holds, which is the backfill.
    await jsm.consumers.add(STREAM, {
      durable_name: DURABLE,
      filter_subject: SUBJECT,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      ack_wait: 30_000_000_000,
      max_ack_pending: 1000,
    });
  }
}

async function handle(m: JsMsg) {
  let f: Fact;
  try {
    f = m.json<Fact>();
  } catch {
    m.term();
    return;
  }
  try {
    await land(f);
    m.ack();
  } catch (err) {
    log('fact %s not stored: %o', f?.id, err);
    m.nak(5_000);
  }
}

/**
 * Consume event.act until the process ends. A dropped connection or a missing
 * stream is retried after a pause; the web server never waits on this.
 */
export async function listen(servers: string) {
  for (;;) {
    try {
      const nc = await connect({ servers, name: 'analytics', maxReconnectAttempts: -1 });
      await durable(await nc.jetstreamManager());
      const consumer = await nc.jetstream().consumers.get(STREAM, DURABLE);
      const messages = await consumer.consume({ max_messages: 200 });
      // eslint-disable-next-line no-console
      console.log(`analytics: consuming ${STREAM}/${SUBJECT} as ${DURABLE}`);
      for await (const m of messages) {
        await handle(m);
      }
      await nc.closed();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('analytics: bus consumer stopped, retrying in 10s', err);
    }
    await new Promise(r => setTimeout(r, 10_000));
  }
}
