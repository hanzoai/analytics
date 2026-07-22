# Hanzo Analytics

## Overview
Privacy-focused web analytics for the Hanzo ecosystem. Multi-tenant IAM integration.

**Upstream**: [Umami](https://github.com/umami-software/umami) (MIT). Branded as **Hanzo Analytics**.

## Tech Stack
- **Language**: TypeScript (Next.js), Go (collector)
- **Database**: PostgreSQL (Prisma ORM), ClickHouse (via hanzoai/datastore)
- **Auth**: Hanzo IAM (hanzo.id) OIDC SSO
- **Infra**: K8s deployment at `universe/infra/k8s/analytics/`

## Build & Run
```bash
pnpm install && pnpm build
pnpm test
```

## Multi-Tenant Architecture
- IAM OIDC login extracts `owner` claim (org slug) from JWT
- `src/lib/iam-org.ts` maps org slug -> deterministic Team UUID (v5)
- Each org gets an auto-created Team; users are auto-assigned on login
- Websites scoped to Teams provide per-org data isolation
- White-label branding via env vars: `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_IAM_PROVIDER_NAME`

## Client SDK — `@hanzo/event` (`packages/event/`)
The ONE browser telemetry client for the Hanzo fleet. Product analytics AND error
capture through one client, one session, one identity — replaces `@hanzo/capture`
(analytics-only) and `@sentry/nextjs` (a second SDK).
- **Analytics**: `pageview`/`capture`/`identify`/`group` -> batched to this backend's
  `POST /v1/analytics` (+ `/v1/tracker` beacon on unload). API preserved verbatim
  from `@hanzo/capture` so the app repoint is a pure import rename.
- **Errors**: `window.onerror` + `unhandledrejection` + a React `ErrorBoundary` +
  manual `captureError` -> a valid **Sentry envelope** on `POST /v1/sentry` with a
  Hanzo-minted DSN (`https://<version>:<hmac>@<host>/v1/sentry/<projectId>`; key rides
  `?sentry_key=` so `sendBeacon` works). Secrets/PII scrubbed client-side before send;
  `user.id` = OIDC subject only, never PII. Envelope round-trip verified against the
  real o11y ingest parser (`errortracking/implerrortracking`).
- **DSN** via `config.dsn` or `NEXT_PUBLIC_HANZO_EVENT_DSN`; absent => error capture is
  inert (fail-safe, analytics unaffected).
- **Ingest target**: `api.hanzo.ai` fronts both paths into `@hanzo/datastore` OLAP —
  `/v1/analytics` -> `src/lib/datastore.ts` -> `compute_events`/`compute_usage`;
  `/v1/sentry` -> o11y sentry ingest -> `o11y_sentry_events`.
- Self-contained package: `cd packages/event && pnpm install --ignore-workspace && pnpm build && pnpm typecheck && pnpm test`.

## Key Integration Points
- **IAM auth**: `src/app/api/auth/iam/route.ts` -- OAuth callback, org assignment
- **Branding**: `src/lib/branding.ts` -- runtime env-based white-label config
- **Insights forwarding**: `src/lib/insights-forward.ts` -- fire-and-forget event forwarding to Insights capture
- **Commerce billing**: `src/lib/commerce.ts` + `src/app/api/cron/billing/route.ts` -- usage metering to Commerce API
- **Collector (Go)**: `collector/` -- standalone event collector with forwarders to Insights, Datastore, and Analytics backends

## K8s Environment Variables (deployment.yaml)
- `DATABASE_URL`, `APP_SECRET`, `KV_URL` -- from KMS via `analytics-secrets`
- `IAM_URL`, `IAM_CLIENT_ID`, `IAM_CLIENT_SECRET` -- Hanzo IAM OIDC
- `INSIGHTS_HOST`, `INSIGHTS_API_KEY` -- event forwarding to Insights
- `COMMERCE_API_URL`, `COMMERCE_TOKEN` -- billing metering
- `DATASTORE_URL` -- ClickHouse connection (optional)
- `ALLOWED_ORIGINS` -- CORS whitelist for tracker scripts
