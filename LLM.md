# Hanzo Analytics

## Overview
Privacy-focused web analytics for the Hanzo ecosystem. Multi-tenant IAM integration.

**Upstream**: [Umami](https://github.com/umami-software/umami) (MIT). Branded as **Hanzo Analytics**.

## Tech Stack
- **Language**: TypeScript (Next.js)
- **Database**: PostgreSQL (Prisma ORM), Hanzo Datastore (`hanzoai/datastore`)
- **Auth**: Hanzo IAM (hanzo.id) OIDC SSO

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

## This repo serves NO `/v1/*` and owns NO client

The measurement product is ONE product and it lives in `hanzoai/cloud`:
`apps/analytics` owns `/v1/analytics` plus the ingest doors `/v1/event` and
`/v1/insights/e`. This repo holds per-site history in its own Postgres; it is not a
second implementation of that surface, and the four things that made it one are
deleted.

**`POST /v1/event` (`src/app/v1/event/route.ts`) — DELETED.** It took a **bare JSON
array** of `{site, ts, type, path, …}` envelopes on a path spelled identically to
cloud's front door, which takes `{batch:[…]}`. Measured, live:

```
POST api.hanzo.ai/v1/event       {"batch":[]}  -> 200 {"accepted":0,"dropped":0}
POST analytics.hanzo.ai/v1/event []            -> 204
```

One path spelling, two protocols, two servers — so a `@hanzo/event` client pointed
at the wrong host failed silently. One door survives and it is cloud's. Do not add
a `/v1/*` route to this repo.

**`public/hz.js` — MOVED to `hanzoai/ui` → `pkgs/event` (`@hanzo/event@0.3.7`).**
The tag is a *client*, and the house has one client home. There it is the
script-tag distribution of `@hanzo/event`: same `WireEvent` batch, same
`POST {host}/v1/event`, default host `api.hanzo.ai`, shipped on the CDN as
`https://unpkg.com/@hanzo/event/hz.js`. Do not add a tracker back here.

**`collector/` (Go) — DELETED.** A THIRD event collector, its own Go module,
deployed nowhere in `universe`, forwarding to a service that no longer exists.

**`src/lib/insights-forward.ts` — DELETED**, with its call site in
`src/app/api/send/route.ts` and its `INSIGHTS_HOST` / `INSIGHTS_API_KEY` env. It
fire-and-forgot every event at that same deleted service.

The client SDK is `hanzoai/ui` → `pkgs/event`, published as `@hanzo/event`. This
repo used to carry a FORK of it at `packages/event` (`@hanzo/event@0.2.0`, never
published). That fork is deleted — do not recreate it. It was not harmless: it held
the ONLY working Sentry-envelope implementation while the published package shipped
a comment claiming `POST /v1/event` was "lensed server-side" into Sentry. It is not,
so every Hanzo property reported **zero** errors for as long as both copies existed.
The envelope + scrub code merged into the canonical package in `@hanzo/event@0.3.2`.

## Key Integration Points
- **IAM auth**: `src/app/api/auth/iam/route.ts` -- OAuth callback, org assignment
- **Branding**: `src/lib/branding.ts` -- runtime env-based white-label config
- **Commerce billing**: `src/lib/commerce.ts` + `src/app/api/cron/billing/route.ts` -- usage metering to Commerce API

## K8s Environment Variables (deployment.yaml)
- `DATABASE_URL`, `APP_SECRET`, `KV_URL` -- from KMS via `analytics-secrets`
- `IAM_URL`, `IAM_CLIENT_ID`, `IAM_CLIENT_SECRET` -- Hanzo IAM OIDC
- `COMMERCE_API_URL`, `COMMERCE_TOKEN` -- billing metering
- `DATASTORE_URL` -- Hanzo Datastore connection (optional)
- `ALLOWED_ORIGINS` -- CORS whitelist for tracker scripts
