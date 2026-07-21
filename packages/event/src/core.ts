// The framework-agnostic telemetry client. ONE client carries two planes over the
// SAME transport, session and identity:
//
//   - analytics: buffered pageview/event/identify/group, flushed as one batch to
//     /v1/analytics (keepalive fetch) — or /v1/tracker via sendBeacon on unload.
//   - errors: window.onerror / unhandledrejection / React boundary / manual
//     captureError, each flushed as a valid Sentry envelope to /v1/sentry.
//
// It NEVER sends the org/tenant: the server stamps that from the validated session.
// The client only supplies its own visitor identity (anon id, session id, and — post
// identify() — the OIDC subject; never email/PII). Errors ride that SAME identity,
// so an error and the pageview before it share one session id and one subject.

import {
  parseAttribution,
  hasAttribution,
  deriveChannel,
} from './attribution'
import { PAGEVIEW } from './events'
import { buildEnvelope, buildSentryEvent, parseDsn, type ErrorIdentity } from './sentry'
import {
  anonId,
  sessionId,
  getFirstTouch,
  setFirstTouchOnce,
  getCohort,
  mergeCohort,
} from './storage'
import type {
  AnalyticsConfig,
  Attribution,
  CaptureErrorOptions,
  Cohort,
  Dsn,
  EventKind,
  SentryEvent,
  Transport,
  WireEvent,
} from './types'
import { VERSION } from './version'

export { VERSION }

const ANALYTICS_PATH = '/v1/analytics'
const TRACKER_PATH = '/v1/tracker' // beacon-on-unload alias
const ENVELOPE_CONTENT_TYPE = 'application/x-sentry-envelope'

function uid(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && 'randomUUID' in c) return c.randomUUID()
  return 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

const isBrowser = () => typeof window !== 'undefined'

/** readEnvDsn resolves a DSN from the public env when config omits one. Next.js
 *  inlines NEXT_PUBLIC_* into the client bundle at build; this is guarded so it is
 *  safe in the browser and in SSR/tests where process may be absent. */
function readEnvDsn(): string | undefined {
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env.NEXT_PUBLIC_HANZO_EVENT_DSN || process.env.HANZO_EVENT_DSN || undefined
    }
  } catch {
    /* no process — browser without inlined env */
  }
  return undefined
}

/** DefaultTransport: fetch(keepalive) for authenticated/normal sends;
 *  navigator.sendBeacon for headerless page-unload beacons. Carries an optional
 *  content type so the error path can send an x-sentry-envelope. */
class DefaultTransport implements Transport {
  send(url: string, body: string, opts: { beacon: boolean; token?: string; contentType?: string }): void {
    const contentType = opts.contentType ?? 'application/json'
    if (opts.beacon && isBrowser() && typeof navigator.sendBeacon === 'function') {
      try {
        navigator.sendBeacon(url, new Blob([body], { type: contentType }))
        return
      } catch {
        /* fall through to fetch */
      }
    }
    if (typeof fetch !== 'function') return
    const headers: Record<string, string> = { 'Content-Type': contentType }
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`
    void fetch(url, {
      method: 'POST',
      headers,
      body,
      keepalive: true,
      credentials: 'include',
    }).catch(() => {
      /* telemetry loss is acceptable; never throw into the app */
    })
  }
}

export class Analytics {
  private cfg: Required<Pick<AnalyticsConfig, 'product' | 'batchSize' | 'flushIntervalMs' | 'enabled'>> &
    AnalyticsConfig
  private transport: Transport
  private queue: WireEvent[] = []
  private errorQueue: SentryEvent[] = []
  private dsn: Dsn | null
  private timer: ReturnType<typeof setTimeout> | null = null
  private personId?: string
  private attribution: Attribution = { utm: {} }
  private cohort: Cohort = {}
  private started = false
  private handlersInstalled = false
  private reentrant = false

  constructor(config: AnalyticsConfig) {
    this.cfg = {
      host: '',
      batchSize: 20,
      flushIntervalMs: 5000,
      enabled: true,
      ...config,
    }
    this.transport = config.transport ?? new DefaultTransport()
    this.dsn = parseDsn(config.dsn ?? readEnvDsn())
  }

  /** init is idempotent and browser-only for its side effects: capture first-touch
   *  attribution, hydrate cohort, register the unload flush, and (unless disabled)
   *  install the global error handlers. Safe to call from a React effect on every
   *  render. */
  init(): void {
    if (this.started || !this.cfg.enabled) return
    this.started = true
    if (!isBrowser()) return

    const parsed = parseAttribution(window.location.search, document.referrer)
    this.attribution = hasAttribution(parsed)
      ? setFirstTouchOnce(parsed)
      : getFirstTouch() ?? parsed
    this.cohort = mergeCohort({
      channel: this.attribution.channel ?? deriveChannel(this.attribution),
      refCode: this.attribution.refCode,
    })

    const flushHidden = () => {
      if (document.visibilityState === 'hidden') this.flush(true)
    }
    window.addEventListener('visibilitychange', flushHidden)
    window.addEventListener('pagehide', () => this.flush(true))

    if (this.cfg.captureErrors !== false) this.installGlobalHandlers()
  }

  /** identify binds the current visitor to a stable person id (post-login). */
  identify(personId: string, traits?: Record<string, unknown>): void {
    this.personId = personId
    this.enqueue('identify', undefined, { properties: traits })
  }

  /** group associates the visitor with an org/team (analytics grouping, not the
   *  server tenant — the server still derives tenant from the session). */
  group(groupId: string, traits?: Record<string, unknown>): void {
    this.enqueue('group', undefined, { groupId, properties: traits })
  }

  /** pageview records a $pageview for the current (or given) location. */
  pageview(path?: string, properties?: Record<string, unknown>): void {
    const url = isBrowser() ? window.location.href : undefined
    const p = path ?? (isBrowser() ? window.location.pathname : undefined)
    this.enqueue('pageview', PAGEVIEW, { url, path: p, properties })
  }

  /** capture records a named product event with optional properties. Commerce
   *  fields (productId/quantity/revenue/currency) may be passed for order events. */
  capture(
    event: string,
    properties?: Record<string, unknown>,
    commerce?: Pick<WireEvent, 'productId' | 'quantity' | 'revenue' | 'currency'>,
  ): void {
    this.enqueue('event', event, { properties, ...commerce })
  }

  /** track is an alias of capture (Segment familiarity). */
  track = this.capture.bind(this)

  /**
   * captureError reports a throwable as a Sentry event on the SAME session/identity
   * as analytics — ONE de-duped ingest (an error is NOT also enqueued as an
   * analytics event). It is total and fail-safe: it never throws into the app, and
   * when no DSN is configured it degrades to a no-op network-wise. Uncaught errors
   * (handled === false) flush immediately (beacon-safe) since the page may be dying.
   */
  captureError(error: unknown, options?: CaptureErrorOptions): void {
    try {
      if (!this.cfg.enabled || !this.dsn) return
      if (!this.started) this.init()
      const event = buildSentryEvent({
        error,
        options,
        identity: this.errorIdentity(),
        capturePII: this.cfg.capturePII === true,
      })
      this.errorQueue.push(event)
      if (options?.handled === false) this.flushErrors(true)
      else this.schedule()
    } catch {
      /* an error reporter must never become a new source of errors */
    }
  }

  /** captureException — @sentry-familiar alias of captureError. */
  captureException = this.captureError.bind(this)

  /** setCohort persists cohort dimensions (e.g. signupWeek at signup) so they ride
   *  every subsequent event. */
  setCohort(patch: Cohort): void {
    this.cohort = mergeCohort(patch)
  }

  /** flush drains BOTH planes to the server. beacon=true uses the unload-safe path.
   *  This is the one flush the timer + unload hooks call — analytics and errors
   *  share it, so there is a single send discipline. */
  flush(beacon = false): void {
    this.flushAnalytics(beacon)
    this.flushErrors(beacon)
  }

  // ── internals ────────────────────────────────────────────────────────────

  private flushAnalytics(beacon: boolean): void {
    if (!this.cfg.enabled || this.queue.length === 0) return
    const batch = this.queue
    this.queue = []
    this.clearTimer()
    const token = this.cfg.getToken?.() ?? undefined
    // sendBeacon cannot carry an Authorization header, so token apps always use
    // keepalive fetch; cookie apps may beacon to the tracker route on unload.
    const useBeacon = beacon && !token
    const path = useBeacon ? TRACKER_PATH : ANALYTICS_PATH
    const body = JSON.stringify({ batch })
    if (this.cfg.debug) console.debug('[event] flush analytics', batch.length, path)
    this.transport.send(this.cfg.host + path, body, { beacon: useBeacon, token: token ?? undefined })
  }

  private flushErrors(beacon: boolean): void {
    if (!this.cfg.enabled || !this.dsn || this.errorQueue.length === 0) return
    const events = this.errorQueue
    this.errorQueue = []
    // The DSN key rides ?sentry_key= in the ingest URL, so this POST needs no
    // header — it works over both keepalive fetch AND sendBeacon on unload.
    for (const event of events) {
      const body = buildEnvelope(event, this.dsn)
      if (this.cfg.debug) console.debug('[event] flush error', event.event_id, this.dsn.ingestUrl)
      this.transport.send(this.dsn.ingestUrl, body, { beacon, contentType: ENVELOPE_CONTENT_TYPE })
    }
  }

  /** errorIdentity is the SAME identity analytics stamps — the OIDC subject (or the
   *  anon id), the current session, and the product/release/environment. Never PII. */
  private errorIdentity(): ErrorIdentity {
    return {
      userId: this.personId ?? anonId(),
      sessionId: sessionId(),
      product: this.cfg.product,
      release: this.cfg.release,
      environment: this.cfg.environment ?? nodeEnv(),
    }
  }

  /** installGlobalHandlers registers non-destructive listeners (addEventListener,
   *  never overwriting window.onerror) for uncaught errors and rejections. Guarded
   *  against re-entrancy so a fault inside capture can't recurse. */
  private installGlobalHandlers(): void {
    if (this.handlersInstalled || !isBrowser()) return
    this.handlersInstalled = true

    window.addEventListener('error', (e: ErrorEvent) => {
      if (this.reentrant) return
      this.reentrant = true
      try {
        const err = e.error ?? new Error(e.message || 'window.onerror')
        this.captureError(err, {
          handled: false,
          properties: { filename: e.filename, lineno: e.lineno, colno: e.colno },
        })
      } catch {
        /* swallow */
      } finally {
        this.reentrant = false
      }
    })

    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      if (this.reentrant) return
      this.reentrant = true
      try {
        const reason = e.reason
        const err = reason instanceof Error ? reason : new Error(stringifyReason(reason))
        this.captureError(err, { handled: false, properties: { kind: 'unhandledrejection' } })
      } catch {
        /* swallow */
      } finally {
        this.reentrant = false
      }
    })
  }

  private enqueue(kind: EventKind, event: string | undefined, extra: Partial<WireEvent>): void {
    if (!this.cfg.enabled) return
    if (!this.started) this.init()
    this.queue.push(this.build(kind, event, extra))
    if (this.queue.length >= this.cfg.batchSize) this.flushAnalytics(false)
    else this.schedule()
  }

  private build(kind: EventKind, event: string | undefined, extra: Partial<WireEvent>): WireEvent {
    const anon = anonId()
    return {
      messageId: uid(),
      type: kind,
      event,
      timestamp: new Date().toISOString(),
      distinctId: this.personId ?? anon,
      anonymousId: anon,
      personId: this.personId,
      sessionId: sessionId(),
      product: this.cfg.product,
      referrer: this.attribution.referrer,
      utm: this.attribution.utm,
      refCode: this.cohort.refCode ?? this.attribution.refCode,
      channel: this.cohort.channel ?? this.attribution.channel,
      signupWeek: this.cohort.signupWeek,
      library: '@hanzo/event',
      libraryVersion: VERSION,
      ...extra,
    }
  }

  private schedule(): void {
    if (this.timer || !this.cfg.enabled) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.cfg.flushIntervalMs)
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

function nodeEnv(): string | undefined {
  try {
    if (typeof process !== 'undefined' && process.env) return process.env.NODE_ENV
  } catch {
    /* no process */
  }
  return undefined
}

function stringifyReason(reason: unknown): string {
  if (typeof reason === 'string') return reason
  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

/** createAnalytics builds a client instance. Most apps use one shared instance. */
export function createAnalytics(config: AnalyticsConfig): Analytics {
  return new Analytics(config)
}

// Re-export the hydrate helpers so consumers can read persisted cohort/attribution
// (e.g. to send refCode to the referrals API) without reaching into storage.
export { getCohort, getFirstTouch }
