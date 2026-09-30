/**
 * What one bus fact is to analytics: the website_event a visit becomes. Pure, so
 * the whole mapping is asserted in a test; src/lib/bus.ts stores what this returns.
 */
import { startOfHour } from 'date-fns';
import { browserName, detectOS } from 'detect-browser';
import { isbot } from 'isbot';
import { EVENT_NAME_LENGTH, EVENT_TYPE } from '@/lib/constants';
import { hash, uuid } from '@/lib/crypto';
import { getDevice } from '@/lib/detect';
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
}

export interface Site {
  id: string;
  domain: string;
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
  'country',
  'screen',
  'language',
  'library',
  'library_version',
  'title',
]);

/** A registered domain in the form hosts are compared in. */
export function bare(domain: string): string {
  return (domain || '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/:].*$/, '')
    .replace(/^www\./, '');
}

/** The website a host belongs to: the longest registered domain it is or ends with. */
export function siteOf(host: string, sites: Site[]): Site | null {
  const h = bare(host);
  if (!h) return null;
  let best: Site | null = null;
  for (const s of sites) {
    const d = bare(s.domain);
    if (d && (h === d || h.endsWith(`.${d}`)) && (!best || d.length > bare(best.domain).length)) {
      best = s;
    }
  }
  return best;
}

export interface Visit {
  session: Parameters<typeof createSession>[0];
  event: Parameters<typeof saveEvent>[0];
  ip?: string;
}

/**
 * The website_event a fact is, or null when it is not a visit: another signal,
 * no url, no registered site, no visitor, an autocapture ($-named) track, or a bot.
 * Pure apart from the id derivation, so the whole mapping is asserted in a test.
 */
export function visitOf(f: Fact, sites: Site[]): Visit | null {
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
  const site = siteOf(url.hostname, sites);
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

  const browser = agent ? browserName(agent) || undefined : undefined;
  const os = agent ? (detectOS(agent) as string) || undefined : undefined;
  const device = agent ? getDevice(agent, a.screen) || undefined : undefined;
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
