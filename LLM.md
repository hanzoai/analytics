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

## Client SDK — `@hanzo/event` lives in `hanzoai/ui`, NOT here

The canonical telemetry client is **`hanzoai/ui` → `pkgs/event`**, published to
npm as `@hanzo/event`. This repo used to carry a FORK of it at `packages/event`
(`@hanzo/event@0.2.0`, never published). That fork is deleted — do not recreate it.

The fork was not harmless. It held the ONLY working Sentry-envelope
implementation while the published package shipped a comment claiming that
`POST /v1/event` was "lensed server-side" into Sentry. It is not, so every Hanzo
property reported **zero** errors to the Sentry dashboard for as long as both
copies existed. The envelope + scrub code was merged into the canonical package
in `@hanzo/event@0.3.2`. One implementation, one home.

What THIS repo owns is the **web-analytics plane**: the `hz.js` tracker
(`public/hz.js`) and its ingest `POST /v1/event` (`src/app/v1/event/route.ts`).
Note that door takes a **bare JSON array** of `{site, ts, type, path, …}`
envelopes — it is a DIFFERENT protocol from `api.hanzo.ai/v1/event`
(`{batch:[…]}`) despite the identical path spelling. An app's `@hanzo/event`
client must point at the API host; pointing it here yields a 400 (and, from a
browser, a failed CORS preflight).


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
