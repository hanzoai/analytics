import { EVENT_TYPE } from '@/lib/constants';
import { websiteIdOf } from '@/lib/project';
import { type Fact, siteOf, visitOf } from '../visit';

process.env.APP_SECRET = 'test-secret';

const HANZO_AI = websiteIdOf('hanzo', 'hanzo-ai');

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function page(over: Partial<Fact> = {}): Fact {
  return {
    signal: 'act',
    org: 'hanzo',
    time: '2026-09-30T08:00:00.000Z',
    id: 'fact-1',
    name: '$pageview',
    kind: 'page',
    url: 'https://www.hanzo.ai/pricing?utm_source=x&gclid=g1',
    path: '/pricing',
    anonymous_id: 'anon-1',
    key: 'pk-hanzoai',
    product: 'hanzo-ai',
    attributes: {
      referrer: 'https://news.example.com/item?id=1',
      utm_source: 'newsletter',
      user_agent: CHROME,
      country: 'US',
      screen: '1440x900',
      language: 'en-US',
    },
    ...over,
  };
}

test('a fact belongs to the website of the project whose key admitted it', () => {
  expect(siteOf(page())).toEqual({
    id: HANZO_AI,
    org: 'hanzo',
    slug: 'hanzo-ai',
    host: 'hanzo.ai',
  });
  expect(websiteIdOf('hanzo', 'hanzo-ai')).toBe(HANZO_AI);
  expect(websiteIdOf('acme', 'hanzo-ai')).not.toBe(HANZO_AI);
  // One way, via the project key: a host alone names no website.
  expect(siteOf(page({ key: undefined }))).toBeNull();
  expect(siteOf(page({ product: undefined }))).toBeNull();
});

test('a page fact is a pageview on its site, keyed on the visitor', () => {
  const v = visitOf(page());
  expect(v).not.toBeNull();
  expect(v.event.websiteId).toBe(HANZO_AI);
  expect(v.event.eventType).toBe(EVENT_TYPE.pageView);
  expect(v.event.eventName).toBeUndefined();
  expect(v.event.hostname).toBe('hanzo.ai');
  expect(v.event.urlPath).toBe('/pricing');
  expect(v.event.urlQuery).toBe('utm_source=x&gclid=g1');
  expect(v.event.referrerDomain).toBe('news.example.com');
  expect(v.event.utmSource).toBe('newsletter');
  expect(v.event.gclid).toBe('g1');
  expect(v.event.country).toBe('US');
  expect(v.event.browser).toBe('chrome');
  expect(v.event.device).toBe('laptop');
  expect(v.session.websiteId).toBe(HANZO_AI);
  expect(v.session.id).toBe(v.event.sessionId);
  // The same visitor on the same site is one session; the same fact is one event.
  expect(visitOf(page({ id: 'fact-2' })).session.id).toBe(v.session.id);
  expect(visitOf(page()).event.id).toBe(v.event.id);
  expect(visitOf(page({ anonymous_id: 'anon-2' })).session.id).not.toBe(v.session.id);
});

test('a named track fact is a custom event carrying its own properties', () => {
  const v = visitOf(
    page({
      kind: 'track',
      name: 'signup_submitted',
      attributes: { method: 'password', utm_source: 'ad', user_agent: CHROME },
    }),
  );
  expect(v.event.eventType).toBe(EVENT_TYPE.customEvent);
  expect(v.event.eventName).toBe('signup_submitted');
  expect(v.event.eventData).toEqual({ method: 'password' });
});

test('what is not a visit is skipped', () => {
  expect(visitOf(page({ kind: 'track', name: '$click' }))).toBeNull();
  expect(visitOf(page({ kind: 'identify', name: 'user_identified' }))).toBeNull();
  expect(visitOf(page({ signal: 'error' }))).toBeNull();
  expect(visitOf(page({ url: undefined }))).toBeNull();
  expect(visitOf(page({ key: undefined }))).toBeNull();
  expect(visitOf(page({ anonymous_id: undefined, distinct_id: undefined }))).toBeNull();
  expect(
    visitOf(
      page({ attributes: { user_agent: 'Googlebot/2.1 (+http://www.google.com/bot.html)' } }),
    ),
  ).toBeNull();
});

test('the device ingest named wins over parsing the agent', () => {
  const v = visitOf(
    page({ attributes: { user_agent: CHROME, browser: 'chrome', os: 'macos', device: 'desktop' } }),
  );
  expect(v.event.os).toBe('macos');
  expect(v.event.device).toBe('desktop');
  expect(v.session.device).toBe('desktop');
});

test('a signed-in visitor without an anonymous id is keyed on distinct_id', () => {
  const v = visitOf(page({ anonymous_id: undefined, distinct_id: 'user-9' }));
  expect(v.event.distinctId).toBe('user-9');
  expect(v.session.distinctId).toBe('user-9');
});
