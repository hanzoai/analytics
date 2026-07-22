// Public types for the Hanzo telemetry client (@hanzo/event).
//
// This file is the union of the analytics capture types (unchanged from
// @hanzo/capture, so the app repoint is a pure rename) and the additive error
// types the Sentry-envelope path needs.

/** The four capture verbs — the closed set the server understands. */
export type EventKind = 'pageview' | 'event' | 'identify' | 'group'

/** First-touch marketing attribution, parsed once and persisted. */
export interface Attribution {
  utm: {
    source?: string
    medium?: string
    campaign?: string
    term?: string
    content?: string
  }
  referrer?: string
  refCode?: string
  /** Derived acquisition channel: direct | organic | paid | social | referral. */
  channel?: string
}

/** Cohort dimensions carried on every event once known (see goals.ts COHORTS). */
export interface Cohort {
  /** ISO week the person first signed up, e.g. "2026-W28". */
  signupWeek?: string
  channel?: string
  refCode?: string
}

/** One event as sent on the wire. tenant/org is NEVER set here — the server
 *  stamps it from the validated session. */
export interface WireEvent {
  messageId: string
  type: EventKind
  event?: string
  timestamp: string
  distinctId?: string
  anonymousId?: string
  personId?: string
  sessionId?: string
  product?: string
  url?: string
  path?: string
  referrer?: string
  utm?: Attribution['utm']
  refCode?: string
  channel?: string
  groupId?: string
  signupWeek?: string
  productId?: string
  quantity?: number
  revenue?: number
  currency?: string
  properties?: Record<string, unknown>
  library?: string
  libraryVersion?: string
}

/** Injectable transports — overridden in tests; default in core.ts uses fetch.
 *  ONE transport carries both the analytics batch and the error envelope, so
 *  there is exactly one send path, one keepalive/beacon discipline. */
export interface Transport {
  /** Durable POST usable during page unload (fetch keepalive / sendBeacon). */
  send(url: string, body: string, opts: TransportOptions): void
}

export interface TransportOptions {
  /** Use the unload-safe path (sendBeacon when no auth header is needed). */
  beacon: boolean
  /** Bearer token for token-auth apps; omitted for cookie/session apps. */
  token?: string
  /** Body content type. Defaults to application/json (the analytics batch).
   *  The error path sets application/x-sentry-envelope. */
  contentType?: string
}

export interface AnalyticsConfig {
  /** Cloud base URL. Same-origin ("") for cookie-auth apps (console/admin);
   *  e.g. "https://api.hanzo.ai" for bearer apps (app/site). */
  host?: string
  /** Emitting surface: console | chat | app | site | admin. */
  product: string
  /** Bearer token provider for token-auth apps. Omit for cookie/session apps
   *  (the client then relies on same-origin credentials). */
  getToken?: () => string | undefined | null
  /** Max events buffered before an automatic flush. */
  batchSize?: number
  /** Auto-flush cadence in ms. */
  flushIntervalMs?: number
  /** Turn the client off entirely (e.g. opt-out / DNT). Defaults to enabled. */
  enabled?: boolean
  /** Override the transport (tests). */
  transport?: Transport
  /** Debug logging. */
  debug?: boolean

  // ── error capture (Sentry envelope -> /v1/sentry) ────────────────────────

  /** Hanzo-minted Sentry DSN: "https://<version>:<hmac>@<host>/v1/sentry/<projectId>".
   *  Public (safe to embed) — the key authorizes writes to ONE project, nothing
   *  else. When absent, the client reads NEXT_PUBLIC_HANZO_EVENT_DSN; when neither
   *  is set, error capture is inert (fail-safe: nothing is sent, nothing throws). */
  dsn?: string
  /** Release identifier stamped on error events (e.g. a git SHA / app version). */
  release?: string
  /** Deployment environment for error events (production | staging | …).
   *  Defaults to NODE_ENV. */
  environment?: string
  /** Install global window.onerror + unhandledrejection handlers on init().
   *  Default true (browser only). Set false to capture only manual/boundary errors. */
  captureErrors?: boolean
  /** Retain end-user PII (emails/IPs) in error text. Default false = scrub
   *  client-side before anything leaves the device (the server scrubs again). */
  capturePII?: boolean
}

// ── Sentry envelope wire types (a from-scratch model of the PUBLIC, documented
//    Sentry ingest protocol — develop.sentry.dev; no upstream code) ───────────

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug'

export interface SentryFrame {
  filename?: string
  function?: string
  module?: string
  abs_path?: string
  lineno?: number
  colno?: number
  in_app?: boolean
}

export interface SentryExceptionValue {
  type?: string
  value?: string
  module?: string
  stacktrace?: { frames: SentryFrame[] }
}

export interface SentryUser {
  /** Stable subject id (OIDC sub / anon id). NEVER email/username/ip. */
  id?: string
}

export interface SentryEvent {
  event_id: string
  timestamp: number
  platform: 'javascript'
  level: SentryLevel
  logger?: string
  environment?: string
  release?: string
  transaction?: string
  fingerprint?: string[]
  message?: string
  exception?: { values: SentryExceptionValue[] }
  tags?: Record<string, string>
  user?: SentryUser
  contexts?: Record<string, Record<string, unknown>>
  sdk?: { name: string; version: string }
}

/** Parsed DSN — the public key + the derived ingest URL. */
export interface Dsn {
  /** "<version>:<hmac>" public key presented via ?sentry_key= (beacon-safe). */
  publicKey: string
  /** Ingest origin, e.g. "https://api.hanzo.ai". */
  origin: string
  /** Project id segment. */
  projectId: string
  /** Fully-derived envelope ingest URL incl. ?sentry_key=. */
  ingestUrl: string
}

/** Options for Analytics.captureError. */
export interface CaptureErrorOptions {
  /** false => uncaught (window.onerror / unhandledrejection / render crash). */
  handled?: boolean
  /** Severity + free-form context; merged into the event's tags/extra. */
  properties?: Record<string, unknown>
  /** Override the event level (default: error, or fatal when handled === false). */
  level?: SentryLevel
}
