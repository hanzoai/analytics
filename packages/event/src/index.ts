// @hanzo/event — framework-agnostic entry. Hanzo's ONE telemetry client:
// product analytics AND error capture over one client, one session, one identity.
//
//   import { createAnalytics, EVENTS } from '@hanzo/event'
//   const a = createAnalytics({ product: 'app', host: 'https://api.hanzo.ai' })
//   a.pageview(); a.capture(EVENTS.SIGNUP_COMPLETED)
//   a.captureError(err)            // -> a Sentry envelope on /v1/sentry
//
// React apps use the './react' entry for the provider, hooks + error boundary.

export { Analytics, createAnalytics, VERSION, getCohort, getFirstTouch } from './core'
export { EVENTS, PAGEVIEW } from './events'
export type { EventName } from './events'
export { GOALS, COHORTS } from './goals'
export type { GoalDef, CohortDef } from './goals'
export {
  parseAttribution,
  deriveChannel,
  hasAttribution,
  hostOf,
  isoWeek,
} from './attribution'

// Error path (Sentry envelope -> /v1/sentry). Pure builders + text redaction are
// exported so consumers (and tests) can inspect exactly what leaves the device.
export {
  parseDsn,
  buildSentryEvent,
  buildEnvelope,
  framesFromStack,
  normalizeError,
  eventId,
} from './sentry'
export type { ErrorIdentity, BuildEventInput } from './sentry'
export { scrubText, redactSecrets, scrubPII } from './scrub'

export type {
  AnalyticsConfig,
  Attribution,
  Cohort,
  EventKind,
  Transport,
  TransportOptions,
  WireEvent,
  // error types
  CaptureErrorOptions,
  Dsn,
  SentryEvent,
  SentryLevel,
  SentryFrame,
  SentryExceptionValue,
  SentryUser,
} from './types'
