import { describe, it, expect, beforeEach } from 'vitest'
import { Analytics } from './core'
import { EVENTS, PAGEVIEW } from './events'
import type { SentryEvent, Transport, TransportOptions, WireEvent } from './types'

interface Sent {
  url: string
  body: string
  beacon: boolean
  token?: string
  contentType?: string
}

class FakeTransport implements Transport {
  sent: Sent[] = []
  send(url: string, body: string, opts: TransportOptions) {
    this.sent.push({ url, body, beacon: opts.beacon, token: opts.token, contentType: opts.contentType })
  }
  /** analytics sends (JSON batch) parsed to their WireEvents. */
  get analytics(): Sent[] {
    return this.sent.filter((s) => s.url.includes('/v1/analytics') || s.url.includes('/v1/tracker'))
  }
  get batch(): WireEvent[] {
    return this.analytics.flatMap((s) => (JSON.parse(s.body) as { batch: WireEvent[] }).batch)
  }
  /** error sends (sentry envelopes) parsed to their events. */
  get errors(): Sent[] {
    return this.sent.filter((s) => s.url.includes('/v1/sentry/'))
  }
  eventFromEnvelope(s: Sent): SentryEvent {
    // header \n item-header \n payload \n
    const lines = s.body.split('\n')
    return JSON.parse(lines[2]) as SentryEvent
  }
}

const DSN = 'https://1:deadbeefcafe@api.hanzo.ai/v1/sentry/00000000-0000-0000-0000-000000000000'

let tx: FakeTransport
function mk(overrides = {}) {
  tx = new FakeTransport()
  return new Analytics({ product: 'app', transport: tx, flushIntervalMs: 999999, ...overrides })
}

// ── analytics parity (ported verbatim from @hanzo/capture core.test) ─────────

describe('Analytics capture (analytics plane — parity with @hanzo/capture)', () => {
  beforeEach(() => {
    tx = new FakeTransport()
  })

  it('flushes an event as a {batch:[...]} with product + name, no tenant/org field', () => {
    const a = mk()
    a.capture(EVENTS.SIGNUP_COMPLETED, { plan: 'pro' })
    a.flush()
    expect(tx.analytics).toHaveLength(1)
    expect(tx.analytics[0].url).toBe('/v1/analytics')
    const e = tx.batch[0]
    expect(e.type).toBe('event')
    expect(e.event).toBe('signup_completed')
    expect(e.product).toBe('app')
    expect(e.properties).toEqual({ plan: 'pro' })
    expect((e as Record<string, unknown>).tenant).toBeUndefined()
    expect((e as Record<string, unknown>).org).toBeUndefined()
    expect((e as Record<string, unknown>).tenantId).toBeUndefined()
    // the library marker is now @hanzo/event
    expect(e.library).toBe('@hanzo/event')
  })

  it('pageview emits the reserved $pageview name', () => {
    const a = mk()
    a.pageview('/pricing')
    a.flush()
    const e = tx.batch[0]
    expect(e.type).toBe('pageview')
    expect(e.event).toBe(PAGEVIEW)
    expect(e.path).toBe('/pricing')
  })

  it('auto-flushes when the batch size is reached', () => {
    const a = mk({ batchSize: 3 })
    a.capture('a')
    a.capture('b')
    expect(tx.analytics).toHaveLength(0)
    a.capture('c')
    expect(tx.analytics).toHaveLength(1)
    expect(tx.batch).toHaveLength(3)
  })

  it('identify binds personId to subsequent distinctId', () => {
    const a = mk()
    a.capture('anon_event')
    a.identify('user-42')
    a.capture('known_event')
    a.flush()
    const anon = tx.batch.find((e) => e.event === 'anon_event')!
    const known = tx.batch.find((e) => e.event === 'known_event')!
    expect(known.personId).toBe('user-42')
    expect(known.distinctId).toBe('user-42')
    expect(anon.personId).toBeUndefined()
  })

  it('carries commerce fields on order events', () => {
    const a = mk()
    a.capture(EVENTS.ORDER_COMPLETED, { kind: 'plan' }, { productId: 'plan_pro', revenue: 49, quantity: 1, currency: 'usd' })
    a.flush()
    const e = tx.batch[0]
    expect(e.productId).toBe('plan_pro')
    expect(e.revenue).toBe(49)
    expect(e.quantity).toBe(1)
    expect(e.currency).toBe('usd')
  })

  it('a disabled client emits nothing', () => {
    const a = mk({ enabled: false })
    a.capture('x')
    a.pageview()
    a.flush()
    expect(tx.sent).toHaveLength(0)
  })

  it('token apps send Authorization and never beacon (headerless) on unload flush', () => {
    const a = mk({ getToken: () => 'jwt-abc' })
    a.capture('x')
    a.flush(true)
    expect(tx.analytics[0].token).toBe('jwt-abc')
    expect(tx.analytics[0].beacon).toBe(false)
    expect(tx.analytics[0].url).toBe('/v1/analytics')
  })

  it('cookie apps beacon to the tracker route on unload flush', () => {
    const a = mk()
    a.capture('x')
    a.flush(true)
    expect(tx.analytics[0].beacon).toBe(true)
    expect(tx.analytics[0].url).toBe('/v1/tracker')
  })

  it('setCohort rides subsequent events', () => {
    const a = mk()
    a.setCohort({ signupWeek: '2026-W29', channel: 'paid', refCode: 'REF9' })
    a.capture('x')
    a.flush()
    const e = tx.batch[0]
    expect(e.signupWeek).toBe('2026-W29')
    expect(e.channel).toBe('paid')
    expect(e.refCode).toBe('REF9')
  })

  it('prefixes the configured host onto the path', () => {
    const a = mk({ host: 'https://api.hanzo.ai' })
    a.capture('x')
    a.flush()
    expect(tx.analytics[0].url).toBe('https://api.hanzo.ai/v1/analytics')
  })
})

// ── error plane (Sentry envelope -> /v1/sentry) ──────────────────────────────

describe('Analytics captureError (error plane)', () => {
  beforeEach(() => {
    tx = new FakeTransport()
  })

  it('posts a Sentry envelope to the DSN ingest url, NOT /v1/analytics', () => {
    const a = mk({ dsn: DSN })
    a.captureError(new TypeError('boom'))
    a.flush()
    expect(tx.errors).toHaveLength(1)
    const s = tx.errors[0]
    expect(s.url).toBe(
      'https://api.hanzo.ai/v1/sentry/00000000-0000-0000-0000-000000000000/envelope/?sentry_key=1%3Adeadbeefcafe',
    )
    expect(s.contentType).toBe('application/x-sentry-envelope')
    const ev = tx.eventFromEnvelope(s)
    expect(ev.platform).toBe('javascript')
    expect(ev.exception?.values[0].type).toBe('TypeError')
    expect(ev.exception?.values[0].value).toBe('boom')
    // no analytics event was emitted for the error — ONE ingest.
    expect(tx.analytics).toHaveLength(0)
  })

  it('is ONE de-duped ingest — an error is not also an analytics event', () => {
    const a = mk({ dsn: DSN })
    a.capture('real_event')
    a.captureError(new Error('err'))
    a.flush()
    // exactly one analytics event (real_event) and one sentry envelope (err)
    expect(tx.batch.map((e) => e.event)).toEqual(['real_event'])
    expect(tx.errors).toHaveLength(1)
    expect(tx.batch.find((e) => e.event === 'err')).toBeUndefined()
  })

  it('error events carry the identified subject (OIDC sub) as user.id — never PII', () => {
    const a = mk({ dsn: DSN })
    a.identify('oidc-sub-123')
    a.captureError(new Error('with identity'))
    a.flush()
    const ev = tx.eventFromEnvelope(tx.errors[0])
    expect(ev.user?.id).toBe('oidc-sub-123')
    // the user object must carry ONLY id — no email/username/ip.
    expect(Object.keys(ev.user ?? {})).toEqual(['id'])
  })

  it('scrubs secrets and emails from the error message before it leaves the device', () => {
    const a = mk({ dsn: DSN })
    a.captureError(new Error('failed for user alice@example.com with token hk-ABCDEFGHIJKLMNOP1234'))
    a.flush()
    const ev = tx.eventFromEnvelope(tx.errors[0])
    const value = ev.exception?.values[0].value ?? ''
    expect(value).not.toContain('alice@example.com')
    expect(value).not.toContain('hk-ABCDEFGHIJKLMNOP1234')
    expect(value).toContain('[email]')
    expect(value).toContain('[redacted]')
  })

  it('an uncaught error (handled:false) flushes immediately, beacon-safe, without an explicit flush', () => {
    const a = mk({ dsn: DSN })
    a.captureError(new Error('fatal'), { handled: false })
    // no a.flush() call — it must have sent already
    expect(tx.errors).toHaveLength(1)
    expect(tx.errors[0].beacon).toBe(true)
    const ev = tx.eventFromEnvelope(tx.errors[0])
    expect(ev.level).toBe('fatal')
    expect(ev.tags?.handled).toBe('false')
  })

  it('a handled error schedules (no send until flush)', () => {
    const a = mk({ dsn: DSN })
    a.captureError(new Error('handled'), { handled: true })
    expect(tx.errors).toHaveLength(0)
    a.flush()
    expect(tx.errors).toHaveLength(1)
    expect(tx.eventFromEnvelope(tx.errors[0]).level).toBe('error')
  })

  it('with NO dsn configured, captureError is a network no-op and never throws', () => {
    const a = mk() // no dsn, no env
    expect(() => a.captureError(new Error('x'), { handled: false })).not.toThrow()
    a.flush()
    expect(tx.sent).toHaveLength(0)
  })

  it('a disabled client captures no errors', () => {
    const a = mk({ enabled: false, dsn: DSN })
    a.captureError(new Error('x'), { handled: false })
    a.flush()
    expect(tx.sent).toHaveLength(0)
  })

  it('captureException is a @sentry-familiar alias of captureError', () => {
    const a = mk({ dsn: DSN })
    a.captureException(new Error('via alias'))
    a.flush()
    expect(tx.errors).toHaveLength(1)
    expect(tx.eventFromEnvelope(tx.errors[0]).exception?.values[0].value).toBe('via alias')
  })
})

// ── one identity, one session across BOTH planes (browser path) ──────────────

describe('shared identity + session across analytics and errors (browser path)', () => {
  function installFakeBrowser() {
    const store = new Map<string, string>()
    const localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    const win: Record<string, unknown> = {
      localStorage,
      location: { search: '', href: 'https://app.hanzo.ai/x', pathname: '/x' },
      addEventListener: () => {},
    }
    // Note: navigator is a read-only getter on modern Node and is not needed here
    // (the transport is injected, so navigator.sendBeacon is never touched).
    const g = globalThis as Record<string, unknown>
    const saved = { window: g.window, document: g.document, localStorage: g.localStorage }
    g.window = win
    g.document = { referrer: '', visibilityState: 'visible' }
    g.localStorage = localStorage
    return () => {
      g.window = saved.window
      g.document = saved.document
      g.localStorage = saved.localStorage
    }
  }

  it('an error and the pageview before it carry the SAME session id and SAME subject', () => {
    const restore = installFakeBrowser()
    try {
      const t = new FakeTransport()
      const a = new Analytics({ product: 'app', transport: t, flushIntervalMs: 999999, dsn: DSN, captureErrors: false })
      a.init()
      a.identify('sub-777')
      a.pageview('/x')
      a.captureError(new Error('boom'))
      a.flush()

      const pv = t.batch.find((e) => e.type === 'pageview')!
      const ev = t.eventFromEnvelope(t.errors[0])
      expect(pv.sessionId).toBeTruthy()
      expect(ev.tags?.session).toBe(pv.sessionId) // one session
      expect(pv.distinctId).toBe('sub-777')
      expect(ev.user?.id).toBe('sub-777') // one subject
    } finally {
      restore()
    }
  })
})
