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

## Visits arrive from cloud's event bus

Every site posts its events to `api.hanzo.ai/v1/event`, the one ingest, and
nothing posts to this app as a destination. `src/lib/bus.ts` binds the durable
`analytics` on cloud's `EVENT` stream, filtered to `event.act`
(`CLOUD_PUBSUB_URL`, nats on `cloud.hanzo.svc:4222`), from `src/instrumentation.ts`
at server start. On its first bind it reads what the stream still holds (three
days), which is the backfill.

`src/lib/visit.ts` is the whole mapping, pure and tested: a `page` fact is a
pageview and a `track` fact with a plain name is a custom event, on the website
whose domain the fact's host is or ends with (so `*.hanzo.app` is `hanzo.app`).
The visitor is `anonymous_id`, else `distinct_id`, and the session is
`uuid(website, visitor)`. The fact id names the stored event, so a redelivery is
refused as a duplicate. Browser, os, device, country, screen and language are
read from the fact's attributes, stamped once at ingest; the agent is parsed
only when ingest did not name the device. The fact vocabulary is HIP-1190 §6.1.

The Hanzo websites belong to team `5340db05…` (uuid v5 of the IAM org `hanzo`).
`/websites` lists a person's own websites and every website of a team they are
in; an admin-org member joins team hanzo on first sign-in.

`/v1/send` (the upstream tracker door) remains only while the last pages that
still load `script.js` move to `@hanzo/event`; delete the route then.

## Every route is `/v1/*`; `/v1/event` is not one of them

The app's routes live in `src/app/v1/**` and nothing is served under `/api/`.
The dashboard calls them through `useApi` (`/v1${url}`), the tracker posts to
`/v1/send` (and `/v1/ast`, `/v1/element`, `/v1/section`), and the recorder rides
the same `/v1/send`. `src/lib/__tests__/v1-surface.test.ts` fails if
`src/app/api` comes back or any first-party file names an `/api/` path again.

The measurement product's ingest door is `hanzoai/cloud`'s: `apps/analytics`
owns `/v1/analytics` plus `/v1/event` and `/v1/insights/e` on api.hanzo.ai. This
repo holds per-site history in its own Postgres and is not a second
implementation of that surface — never add `src/app/v1/event` or
`src/app/v1/analytics` here.

**`POST /v1/event` (`src/app/v1/event/route.ts`) — DELETED.** It took a **bare JSON
array** of `{site, ts, type, path, …}` envelopes on a path spelled identically to
cloud's front door, which takes `{batch:[…]}`. One path spelling, two protocols,
two servers — so a `@hanzo/event` client pointed at the wrong host failed
silently. One door survives and it is cloud's.

**`public/hz.js` — MOVED to `hanzoai/ui` → `pkgs/event` (`@hanzo/event@0.3.7`).**
The tag is a *client*, and the house has one client home. There it is the
script-tag distribution of `@hanzo/event`: same `WireEvent` batch, same
`POST {host}/v1/event`, default host `api.hanzo.ai`, shipped on the CDN as
`https://unpkg.com/@hanzo/event/hz.js`. Do not add a tracker back here.

**`collector/` (Go) — DELETED.** A THIRD event collector, its own Go module,
deployed nowhere in `universe`, forwarding to a service that no longer exists.

**`src/lib/insights-forward.ts` — DELETED**, with its call site in
`src/app/v1/send/route.ts` and its `INSIGHTS_HOST` / `INSIGHTS_API_KEY` env. It
fire-and-forgot every event at that same deleted service.

The client SDK is `hanzoai/ui` → `pkgs/event`, published as `@hanzo/event`. This
repo used to carry a FORK of it at `packages/event` (`@hanzo/event@0.2.0`, never
published). That fork is deleted — do not recreate it. It was not harmless: it held
the ONLY working Sentry-envelope implementation while the published package shipped
a comment claiming `POST /v1/event` was "lensed server-side" into Sentry. It is not,
so every Hanzo property reported **zero** errors for as long as both copies existed.
The envelope + scrub code merged into the canonical package in `@hanzo/event@0.3.2`.

## Key Integration Points
- **IAM auth**: `src/app/auth/callback` (redirect_uri `/auth/callback`) + `src/app/v1/auth/verify/route.ts`
- **Branding**: `src/lib/branding.ts` -- runtime env-based white-label config
- **Commerce billing**: `src/lib/commerce.ts` + `src/app/v1/cron/billing/route.ts` -- usage metering to Commerce `/v1/billing/usage` (inert: COMMERCE_API_URL is unset in prod, and the payload is not the shape commerce's RecordUsage binds)

## K8s Environment Variables (deployment.yaml)
- `DATABASE_URL`, `APP_SECRET`, `KV_URL` -- from KMS via `analytics-secrets`
- `IAM_URL`, `IAM_CLIENT_ID`, `IAM_CLIENT_SECRET` -- Hanzo IAM OIDC
- `COMMERCE_API_URL`, `COMMERCE_TOKEN` -- billing metering
- `DATASTORE_URL` -- Hanzo Datastore connection (optional)
- `ALLOWED_ORIGINS` -- CORS whitelist for tracker scripts
