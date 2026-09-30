/**
 * What one bus fact is to analytics: the website_event a visit becomes, on the
 * website of the cloud project whose key admitted it (src/lib/project.ts). Pure, so
 * the whole mapping is asserted in a test; src/lib/bus.ts stores what this returns.
 */
import { startOfHour } from 'date-fns';
import { browserName, detectOS } from 'detect-browser';
import { isbot } from 'isbot';
import { EVENT_NAME_LENGTH, EVENT_TYPE } from '@/lib/constants';
import { hash, uuid } from '@/lib/crypto';
import { getDevice } from '@/lib/detect';
import { websiteIdOf } from '@/lib/project';
import type { createSession, saveEvent } from '@/queries/sql';

/** One fact as cloud puts it on the bus (apps/event/bus.go `message`). */
export interface Fact {
  signal?: string;
  org?: string;
  time: string;
  id: string;
  name?: string;
  kind?: string;
  url?: string;
  path?: string;
  distinct_id?: string;
  anonymous_id?: string;
  attributes?: Record<string, string>;
  ip?: string;
  /** The project key that admitted the fact, and the project's slug beside it. */
  key?: string;
  product?: string;
}

export interface Site {
  id: string;
  org: string;
  slug: string;
  host: string;
}

/** Attributes that become columns, so they are not repeated as event data. */
const COLUMNS = new Set([
  'referrer',
  'referrer_domain',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'user_agent',
  'browser',
  'os',
  'device',
  'country',
  'screen',
  'language',
  'library',
  'library_version',
  'title',
]);

/**
 * The website a fact belongs to: the cloud project whose key admitted it. A project
 * key admission carries the project's slug as the fact's product, so (org, product)
 * names the project, and an unkeyed fact belongs to no website.
 */
export function siteOf(f: Fact): Site | null {
  if (!f.key || !f.org || !f.product) return null;
  let host = '';
  try {
    host = f.url ? new URL(f.url).hostname.replace(/^www\./, '') : '';
  } catch {
    host = '';
  }
  return { id: websiteIdOf(f.org, f.product), org: f.org, slug: f.product, host };
}

export interface Visit {
  site: Site;
  session: Parameters<typeof createSession>[0];
  event: Parameters<typeof saveEvent>[0];
  ip?: string;
}

/**
 * The website_event a fact is, or null when it is not a visit: another signal,
 * no url, no project key, no visitor, an autocapture ($-named) track, or a bot.
 * Pure apart from the id derivation, so the whole mapping is asserted in a test.
 */
export function visitOf(f: Fact): Visit | null {
  if (f.signal && f.signal !== 'act') return null;
  const page = f.kind === 'page';
  const named = f.kind === 'track' && !!f.name && !f.name.startsWith('$');
  if (!page && !named) return null;
  if (!f.url) return null;

  let url: URL;
  try {
    url = new URL(f.url);
  } catch {
    return null;
  }
  const site = siteOf(f);
  if (!site) return null;

  const visitor = f.anonymous_id || f.distinct_id;
  if (!visitor) return null;

  const a = f.attributes || {};
  const agent = a.user_agent || '';
  if (agent && isbot(agent)) return null;

  const createdAt = new Date(f.time);
  if (Number.isNaN(createdAt.getTime())) return null;

  const sessionId = uuid(site.id, visitor);
  const visitId = uuid(sessionId, hash(startOfHour(createdAt).toUTCString()));

  // Ingest names the device once for every store; the agent is parsed here only
  // when it did not.
  const browser = a.browser || (agent ? browserName(agent) || undefined : undefined);
  const os = a.os || (agent ? (detectOS(agent) as string) || undefined : undefined);
  const device = a.device || (agent ? getDevice(agent, a.screen) || undefined : undefined);
  const country = a.country || undefined;

  let referrerPath: string | undefined;
  let referrerQuery: string | undefined;
  let referrerDomain: string | undefined;
  if (a.referrer) {
    try {
      const r = new URL(a.referrer, url.origin);
      referrerPath = r.pathname;
      referrerQuery = r.search.substring(1);
      referrerDomain = r.hostname.replace(/^www\./, '');
    } catch {
      referrerDomain = a.referrer_domain;
    }
  }

  const data: Record<string, string> = {};
  if (named) {
    for (const [k, v] of Object.entries(a)) {
      if (!k.startsWith('$') && !COLUMNS.has(k)) data[k] = v;
    }
  }

  const q = url.searchParams;
  return {
    site,
    ip: f.ip,
    session: {
      id: sessionId,
      websiteId: site.id,
      browser,
      os,
      device,
      screen: a.screen,
      language: a.language,
      country,
      distinctId: f.distinct_id,
      createdAt,
    },
    event: {
      id: uuid('bus', f.id),
      websiteId: site.id,
      sessionId,
      visitId,
      eventType: page ? EVENT_TYPE.pageView : EVENT_TYPE.customEvent,
      createdAt,
      pageTitle: a.title,
      hostname: url.hostname.replace(/^www\./, ''),
      urlPath: f.path || url.pathname,
      urlQuery: url.search.substring(1),
      referrerPath,
      referrerQuery,
      referrerDomain,
      distinctId: f.distinct_id,
      browser,
      os,
      device,
      screen: a.screen,
      language: a.language,
      country,
      eventName: named ? f.name.substring(0, EVENT_NAME_LENGTH) : undefined,
      eventData: Object.keys(data).length ? data : undefined,
      utmSource: a.utm_source || q.get('utm_source') || undefined,
      utmMedium: a.utm_medium || q.get('utm_medium') || undefined,
      utmCampaign: a.utm_campaign || q.get('utm_campaign') || undefined,
      utmContent: a.utm_content || q.get('utm_content') || undefined,
      utmTerm: a.utm_term || q.get('utm_term') || undefined,
      gclid: q.get('gclid') || undefined,
      fbclid: q.get('fbclid') || undefined,
      msclkid: q.get('msclkid') || undefined,
      ttclid: q.get('ttclid') || undefined,
      lifatid: q.get('li_fat_id') || undefined,
      twclid: q.get('twclid') || undefined,
    },
  };
}
