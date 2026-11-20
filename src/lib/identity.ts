import {
  CONFIRMED_PAYMENT_EVENT_NAME,
  isConfirmedServerPaymentEvent,
  normalizeHostname,
} from './funnel';

export const HANZO_ECOSYSTEM_DOMAINS = [
  'hanzo.ai',
  'hanzo.app',
  'hanzo.bot',
  'hanzo.team',
  'platform.hanzo.ai',
] as const;

const HANZO_ROOT_DOMAINS = ['hanzo.ai', 'hanzo.app', 'hanzo.bot', 'hanzo.team'] as const;

export const CROSS_DOMAIN_IDENTITY_PARAMS = ['hz_aid', 'hz_sid', 'visitor_id'] as const;

export interface CrossDomainIdentity {
  hz_aid?: string;
  hz_sid?: string;
  visitor_id?: string;
}

export function isHanzoEcosystemHost(rawHostOrUrl?: string | null): boolean {
  if (!rawHostOrUrl) return false;
  const host = normalizeHostname(rawHostOrUrl);
  return HANZO_ROOT_DOMAINS.some(root => host === root || host.endsWith(`.${root}`));
}

function cleanId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return undefined;
  if (!/^[a-zA-Z0-9._:-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

export function extractCrossDomainIdentity(
  urlOrSearch?: string | null,
  payload?: Record<string, unknown> | null,
): CrossDomainIdentity {
  const fromUrl: CrossDomainIdentity = {};

  if (urlOrSearch) {
    try {
      const parsed = urlOrSearch.startsWith('?')
        ? new URL(`https://hanzo.ai/${urlOrSearch}`)
        : new URL(urlOrSearch, 'https://hanzo.ai');
      fromUrl.hz_aid = cleanId(parsed.searchParams.get('hz_aid'));
      fromUrl.hz_sid = cleanId(parsed.searchParams.get('hz_sid'));
      fromUrl.visitor_id = cleanId(parsed.searchParams.get('visitor_id'));
    } catch {
      // ignore invalid URLs
    }
  }

  const hz_aid = cleanId(payload?.hz_aid) ?? fromUrl.hz_aid;
  const hz_sid = cleanId(payload?.hz_sid) ?? fromUrl.hz_sid;
  const visitor_id = cleanId(payload?.visitor_id) ?? fromUrl.visitor_id ?? hz_aid;

  return {
    ...(hz_aid ? { hz_aid } : {}),
    ...(hz_sid ? { hz_sid } : {}),
    ...(visitor_id ? { visitor_id } : {}),
  };
}

export function resolveCanonicalVisitorId(input: {
  distinctId?: string | null;
  visitor_id?: string | null;
  hz_aid?: string | null;
}): string | undefined {
  return cleanId(input.distinctId) ?? cleanId(input.visitor_id) ?? cleanId(input.hz_aid);
}

/**
 * Decorates outbound navigation URLs targeting Hanzo ecosystem domains with
 * `hz_aid`, `hz_sid`, and `visitor_id` so identity survives cross-TLD hops
 * (`hanzo.ai -> hanzo.app -> hanzo.bot -> hanzo.team -> platform.hanzo.ai`).
 * Never leaks identity query parameters to non-Hanzo domains.
 */
export function decorateCrossDomainUrl(targetUrl: string, identity: CrossDomainIdentity): string {
  try {
    const parsed = new URL(targetUrl);
    if (!isHanzoEcosystemHost(parsed.hostname)) {
      return targetUrl;
    }

    const hzAid = cleanId(identity.hz_aid);
    const hzSid = cleanId(identity.hz_sid);
    const visitorId = cleanId(identity.visitor_id) ?? hzAid;

    if (hzAid && !parsed.searchParams.has('hz_aid')) {
      parsed.searchParams.set('hz_aid', hzAid);
    }
    if (hzSid && !parsed.searchParams.has('hz_sid')) {
      parsed.searchParams.set('hz_sid', hzSid);
    }
    if (visitorId && !parsed.searchParams.has('visitor_id')) {
      parsed.searchParams.set('visitor_id', visitorId);
    }

    return parsed.toString();
  } catch {
    return targetUrl;
  }
}

export interface CrossDomainJourneyEvent {
  hostname: string;
  route: string;
  eventName: string;
  timestamp: number;
  hz_aid?: string;
  hz_sid?: string;
  visitor_id?: string;
  distinct_id?: string;
  eventData?: Record<string, any>;
}

export interface StitchedActivationJourney {
  canonicalId: string;
  visitor_ids: string[];
  hz_aids: string[];
  hz_sids: string[];
  distinct_ids: string[];
  hostnames: string[];
  events: CrossDomainJourneyEvent[];
  confirmedPaymentCount: number;
  isActivated: boolean;
}

/**
 * Stitches cross-domain events sharing any identity token (`visitor_id`, `hz_aid`,
 * `hz_sid`, or `distinct_id`) via union-find into unified activation journeys.
 */
export function stitchActivationJourneys(
  events: CrossDomainJourneyEvent[],
): StitchedActivationJourney[] {
  if (!events.length) return [];

  const parent = new Map<string, string>();

  const find = (key: string): string => {
    let cur = key;
    let nextParent = parent.get(cur);
    while (nextParent && nextParent !== cur) {
      cur = nextParent;
      nextParent = parent.get(cur);
    }
    let walk = key;
    let walkParent = parent.get(walk);
    while (walkParent && walkParent !== cur) {
      parent.set(walk, cur);
      walk = walkParent;
      walkParent = parent.get(walk);
    }
    return cur;
  };

  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(rb, ra);
    }
  };

  const eventTokens = events.map((ev, index) => {
    const tokens: string[] = [];
    if (ev.visitor_id) tokens.push(`vid:${ev.visitor_id}`);
    if (ev.hz_aid) tokens.push(`aid:${ev.hz_aid}`);
    if (ev.hz_sid) tokens.push(`sid:${ev.hz_sid}`);
    if (ev.distinct_id) tokens.push(`did:${ev.distinct_id}`);
    if (tokens.length === 0) {
      tokens.push(`anon:${index}`);
    }
    for (const token of tokens) {
      if (!parent.has(token)) parent.set(token, token);
    }
    for (let i = 1; i < tokens.length; i++) {
      union(tokens[0], tokens[i]);
    }
    return tokens[0];
  });

  const groups = new Map<string, CrossDomainJourneyEvent[]>();
  events.forEach((ev, idx) => {
    const root = find(eventTokens[idx]);
    const list = groups.get(root) || [];
    list.push(ev);
    groups.set(root, list);
  });

  const journeys: StitchedActivationJourney[] = [];

  for (const groupEvents of groups.values()) {
    const sorted = [...groupEvents].sort((a, b) => a.timestamp - b.timestamp);
    const visitorIds = new Set<string>();
    const hzAids = new Set<string>();
    const hzSids = new Set<string>();
    const distinctIds = new Set<string>();
    const hostnames: string[] = [];
    let confirmedPaymentCount = 0;

    for (const ev of sorted) {
      if (ev.visitor_id) visitorIds.add(ev.visitor_id);
      if (ev.hz_aid) hzAids.add(ev.hz_aid);
      if (ev.hz_sid) hzSids.add(ev.hz_sid);
      if (ev.distinct_id) distinctIds.add(ev.distinct_id);
      const host = normalizeHostname(ev.hostname);
      if (!hostnames.includes(host)) {
        hostnames.push(host);
      }
      if (
        ev.eventName === CONFIRMED_PAYMENT_EVENT_NAME &&
        isConfirmedServerPaymentEvent(ev.eventName, ev.eventData)
      ) {
        confirmedPaymentCount += 1;
      }
    }

    const canonicalId =
      Array.from(distinctIds)[0] ||
      Array.from(visitorIds)[0] ||
      Array.from(hzAids)[0] ||
      Array.from(hzSids)[0] ||
      'unknown';

    journeys.push({
      canonicalId,
      visitor_ids: Array.from(visitorIds),
      hz_aids: Array.from(hzAids),
      hz_sids: Array.from(hzSids),
      distinct_ids: Array.from(distinctIds),
      hostnames,
      events: sorted,
      confirmedPaymentCount,
      isActivated: confirmedPaymentCount > 0,
    });
  }

  return journeys;
}
