# @hanzo/event

Hanzo's **one** browser telemetry client. Product analytics **and** error capture
through a single client, a single session, and a single identity — no second SDK,
no double-send.

- **Analytics**: `pageview` / `capture` (event) / `identify` / `group`, batched and
  flushed to `POST /v1/analytics` (keepalive `fetch`) — or `/v1/tracker` via
  `navigator.sendBeacon` on page unload.
- **Errors**: global `window.onerror` + `unhandledrejection` handlers, a React
  `ErrorBoundary`, and manual `captureError`, each shipped as a valid **Sentry
  envelope** to `POST /v1/sentry` with a Hanzo-minted DSN — through the SAME
  transport, session id and subject as analytics.

It replaces **`@hanzo/capture`** (the previous analytics-only client) and
**`@sentry/nextjs`** (a whole second telemetry SDK).

## The 3 → 1 consolidation

| Package | What it was | Disposition |
| --- | --- | --- |
| `@hanzo/capture` (`ui/pkgs/capture`) | Browser analytics client (provider, hooks, batched `/v1/analytics`) | **Folded in** — its API is preserved verbatim here, so the app repoint is a pure import rename. |
| `@hanzo/analytics` (`analytics/`, v3.0.x) | The analytics **backend** (Umami-derived Next.js app) + the `@hanzo/analytics-components` dashboard UI | **Distinct layer** — it is the *server* that receives `/v1/analytics` and writes the warehouse, plus dashboard components. `@hanzo/event` is the *client* that talks to it. Not folded; it is the ingest target. |
| `@hanzo/events` (`universe-tasks/packages/events`) | A **server-side** Node writer that opens a direct ClickHouse connection (username/password) and inserts rows | **Distinct + superseded** — it holds database credentials and cannot run in a browser. Its role (server → warehouse) is served by the analytics backend behind `api.hanzo.ai`; retire it. Its schema documents the warehouse columns. |

## Usage (React / Next.js)

```tsx
'use client'
import { createAnalytics } from '@hanzo/event'
import { AnalyticsProvider, ErrorBoundary, useAnalytics, usePageview } from '@hanzo/event/react'

const client = createAnalytics({
  product: 'app',
  host: 'https://api.hanzo.ai',
  getToken: () => tokenRef.current ?? undefined, // bearer apps; omit for cookie apps
})

<AnalyticsProvider client={client}>
  <ErrorBoundary>{children}</ErrorBoundary>
</AnalyticsProvider>

// inside components:
const a = useAnalytics()
usePageview(usePathname())
a.identify(user.sub)                 // OIDC subject — never email/PII
a.capture(EVENTS.SIGNUP_COMPLETED)
a.captureError(err, { handled: true })
```

## Identity

The client never sends the org/tenant — the server stamps that from the validated
session. It supplies only its own visitor identity: a stable anon id, a 30-minute
session id, and — after `identify()` — the **OIDC subject** (`sub`). Error events
carry that same subject as `user.id` and **nothing else** (no email, username, or
IP). Free-text error values/messages are secret- and PII-scrubbed client-side
(`scrub.ts`) before anything leaves the device; the server scrubs again.

## Error DSN

`captureError` needs a Hanzo-minted Sentry DSN:

```
https://<version>:<hmac>@<host>/v1/sentry/<projectId>
```

The public key (`<version>:<hmac>`) is safe to embed — it only authorizes writes to
one project. Provide it via `config.dsn` or the `NEXT_PUBLIC_HANZO_EVENT_DSN`
environment variable. When neither is set, error capture is inert (nothing is sent,
nothing throws). Mint a DSN with the o11y ingest secret
(`implsentry.mintDSN` / `MintDSN`); rotate per-project by bumping its key version.

The client derives the ingest URL as
`https://<host>/v1/sentry/<projectId>/envelope/?sentry_key=<version>:<hmac>` — the
key rides `?sentry_key=` (not the envelope body) because that is the credential
channel the server trusts and the only one `sendBeacon` can carry on unload.

## Ingestion → @hanzo/datastore (OLAP)

`@hanzo/event` is the client; the warehouse is `@hanzo/datastore` (a ClickHouse
fork). `api.hanzo.ai` fronts two server ingest paths that both land in datastore:

```
@hanzo/event (browser)
   ├── /v1/analytics + /v1/tracker ──▶ analytics backend (src/lib/datastore.ts)
   │                                     └─▶ @hanzo/datastore: compute_events / compute_usage
   └── /v1/sentry/<project>/envelope/ ─▶ o11y sentry ingest (envelope → occurrence)
                                          └─▶ @hanzo/datastore: o11y_sentry_events
```

One client, one identity → one de-duped ingest → one OLAP warehouse.

## Build / test

```bash
pnpm install   # or: npm install
pnpm build     # tsup -> dist (cjs + esm + d.ts) for . and ./react
pnpm typecheck # tsc --noEmit
pnpm test      # vitest (analytics parity, error routing, scrub, envelope round-trip, grouping)
```
