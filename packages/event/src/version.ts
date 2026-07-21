// One source of truth for the client version — stamped on every wire event
// (libraryVersion) and every Sentry event (sdk.version). Kept in sync with
// package.json. Lives in its own module so core.ts and sentry.ts can share it
// without a circular import.
export const VERSION = '0.2.0'
