# Architecture note — Huemen.studio

Companion to [`AGENTS.md`](../AGENTS.md) (orientation) and the build brief. This
is the "architecture note" required at handover (brief §11).

## Shape

Next.js (App Router) monolith + Postgres. No exotic infra — the client owns and
runs this after handover.

```
Browser ── Next.js (RSC + server actions) ──┬── Postgres (RLS)      tenant data
                                             ├── Object storage     uploads + images
                                             ├── AI facade          text + image providers
                                             └── Job queue (pg)      batch generation
```

## Tenant isolation (INV-1) — the load-bearing design

Two lines of defence, DB first:

1. **Postgres RLS (primary).** Every table has `tenant_id`; every table has
   `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy keyed to
   `app.current_tenant` (a transaction-local GUC). See
   [`migrations/0002_rls.sql`](../migrations/0002_rls.sql).
2. **Application scope (secondary).** The app connects as the non-owner role
   `huemen_app` (NOSUPERUSER, NOBYPASSRLS), so RLS always applies. Every
   request-serving query runs inside
   [`withTenantSession`](../src/db/session.ts), which sets the GUCs from the
   VERIFIED session — never from client input. Access is refused early by
   [`resolveScope`](../src/lib/auth/scope.ts) before the GUC is even set.

Admin cross-tenant reads (workspace management + usage analytics) are an
*additional* `admin_all` policy on management/log tables only. Client CONTENT
tables have no admin bypass, so an admin-code bug cannot leak one client's
content to another.

Proven by [`tests/isolation.test.ts`](../tests/isolation.test.ts), which runs in
CI and blocks merge.

## The brand context object (INV-2) — the anti-drift design

`brand_profiles + voice_guides + visual_identities` compose into ONE serialised,
versioned block via [`buildBrandContext`](../src/lib/context/context-builder.ts)
(pure, unit-tested) loaded by
[`loadBrandContext`](../src/lib/context/context-loader.ts). Every prompt is
assembled by the AI facade as **system template + context block + task input**.
`CONTEXT_VERSION` is stamped on content for traceability. No module builds its
own context.

## AI layer

[`src/lib/ai`](../src/lib/ai) — one `TextProvider` and one `ImageProvider`
interface, provider + model chosen from env config. Retry/fallback lives once in
the facade; every call writes a `generation_logs` row before returning (no silent
failures). Dev uses deterministic mock providers (no keys, no network).

## Storage

[`src/lib/storage`](../src/lib/storage) — driver interface + local-disk dev
driver. Keys are always tenant-prefixed (`tenantKey()`); reads go through
short-lived HMAC-signed URLs. Production swaps in an S3 driver via env.

## Data model

See [`migrations/0001_core_schema.sql`](../migrations/0001_core_schema.sql) — the
14 core objects (brief §03) plus support tables (generation history, coach
assignments, usage caps, admin audit log, job queue). A rendered ER diagram is a
handover deliverable (TASKS P4-14).

## Local dev

Postgres via [`docker-compose.yml`](../docker-compose.yml) on host port **5544**
(avoids a native Postgres on 5432). See [`README`](../README.md).
