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

## Datastore = ClickHouse (zero fork-diff)
Hanzo Datastore is Hanzo's ClickHouse fork; operators set **`DATASTORE_URL`**. The query
layer (`src/lib/clickhouse.ts`, `src/lib/db.ts`) is kept **byte-identical to upstream**, which
reads `CLICKHOUSE_URL`. `src/instrumentation.ts` `register()` aliases at server bootstrap:
`if (!process.env.CLICKHOUSE_URL && process.env.DATASTORE_URL) process.env.CLICKHOUSE_URL = process.env.DATASTORE_URL`.
This replaced the previous in-place `CLICKHOUSE_URL->DATASTORE_URL` rename + a duplicate
`src/lib/datastore.ts` module (deleted); all query files now use the stock
`clickhouse`/`CLICKHOUSE` convention. Values-not-places -> upstream `clickhouse.ts`/`db.ts`
merge cleanly forever. Write path stays no-Kafka direct-insert (`if (kafka.enabled) ... else insert()`).

## Web Vitals (LCP/INP/CLS/FCP/TTFB)
Cookieless, no PII. Enable per-site with `data-performance="true"` on the tracker `<script>`.
- **Write:** tracker `src/tracker/index.js` `initPerformance()` collects TTFB/FCP/LCP
  (PerformanceObserver), CLS (session-window), INP (p98 @ 40ms), re-flushes on SPA nav, sends
  `type:'performance'`. `src/app/api/send/route.ts` validates the metrics and writes
  `EVENT_TYPE.performance (=5)`. `saveEvent` persists `lcp/inp/cls/fcp/ttfb` (Datastore path;
  relational/prisma path unchanged — Datastore-only). CH columns: migration `09_add_performance.sql`.
- **Read:** `/api/reports/performance` → `getPerformance*` / `performance/getPerformanceStats.ts`,
  querying `website_event` directly with `event_type = 5`. `performanceReportSchema` is a variant of
  `reportResultSchema`'s discriminatedUnion (without it, a `type:'performance'` request 400s).
- **SQLi guard:** `metric` is interpolated into raw SQL (`order by ${metric}`, `quantile(${metric})`),
  so it is allowlisted against `PERFORMANCE_METRICS` (constants.ts, single source of truth) at BOTH
  the API boundary (`z.enum(PERFORMANCE_METRICS)`) and in the query funcs (`find(...) ?? 'lcp'`).
- Rebuild tracker: `pnpm build-tracker` (-> gitignored `public/script.js`).

## Property pivot (deferred)
`clickhouse.ts getPropertyFilterQuery()` exists (it came in with the stock `clickhouse.ts` revert) but
has **no caller** in this fork — the upstream property-query layer (getEventData*/getSessionData* pivot
consumers) is not ported. So the pivot **migration was NOT shipped**: an `event_data_pivot`
AggregatingMergeTree + MV firing on every insert with zero read benefit is pure write-amplification.
Ship migration `11` (upstream) only once those readers are wired.

## ClickHouse migration runbook (operator-applied to live Datastore)
Canonical DB is **`analytics`** (derived from the `DATASTORE_URL` pathname; schema.sql + migrations
01–08 qualify tables as `analytics.*`). Apply against `DATASTORE_URL` (`clickhouse-client < FILE`),
idempotent:
1. `09_add_performance.sql` — adds nullable `lcp/inp/cls/fcp/ttfb` to `analytics.website_event` +
   rebuilds `analytics.website_event_stats_hourly_mv` so `views` excludes `event_type IN (2,5)`
   (i.e. perf events don't inflate view counts). **No backfill** — perf columns are NULL for
   historical rows; type-5 is new so there is no view discontinuity for types 1/3/4.
   *(`10_add_session_replay.sql` was also `analytics.`-corrected here — same `umami.`→`analytics.` bug.)*
- **MV backfill caveat (general):** materialized views only capture rows inserted *after* creation.
  For any *new* aggregate added later, run an `INSERT ... SELECT` over historical
  `analytics.website_event` / `analytics.event_data` to backfill.
