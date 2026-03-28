# LLM.md - Hanzo Analytics

## Overview
Privacy-focused web analytics for the Hanzo ecosystem. Umami fork with multi-tenant IAM integration.

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
