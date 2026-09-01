# HANDOVER.md — Huemen.studio

> **You are picking up an in-progress build.** This file is the fast path to
> being productive. Read it fully, then start at the "Next work" section.
> Authority order: [`AGENTS.md`](AGENTS.md) (invariants + design) →
> [`TASKS.md`](TASKS.md) (worklist + status) → the brief PDF →
> [`docs/`](docs/). This file summarises; those are canonical.

---

## 1. What this is (30 seconds)

Multi-tenant SaaS "personal-brand OS", white-labelled to **The Brand Professor**.
A brand is defined **once** (Brand Foundation); all copy + images are generated
from that stored context. Next.js 16 (App Router) + TypeScript + Tailwind 4 +
Postgres 18 (RLS). Handover-friendly — the client will own and run it.

**Two invariants you must never break** (full text in AGENTS.md §2):
- **INV-1 — Tenant isolation at the DB layer.** Every table has `tenant_id`;
  Postgres RLS (enabled + FORCED) is the primary line; the app connects as a
  non-owner role so RLS always applies. Cross-tenant tests block merge.
- **INV-2 — One versioned context builder.** `brand_profiles + voice_guides +
  visual_identities` → one serialised block via ONE function
  ([`context-builder.ts`](src/lib/context/context-builder.ts)). No module builds
  its own context. Prompts = system template + context block + task input.

**UI look** (AGENTS.md §3.5): editorial, monochrome + one vermilion accent
(`#FF3429`), grotesque sans + serif-italic accent, uppercase micro-labels,
generous whitespace. All colours are CSS tokens in
[`globals.css`](src/app/globals.css) — never hardcode hex; per-tenant branding
overrides them. Translate the brand *feeling*, do NOT copy the marketing site's
scroll-jacking/animation.

---

## 2. Current state (as of this handover)

**Phase 0 + Phase 1 are complete and verified.** 14 tests green (context builder,
cross-tenant isolation, storage); typecheck + lint + `next build` clean.

Working + verified end to end:
- DB schema (14 core + support tables) + RLS + cross-tenant isolation tests.
- Versioned context builder (unit-tested) + DB loader.
- Provider-agnostic AI facade (mock providers) with logging + retry.
- Auth (dev cookie adapter) + role/scope resolution; storage (local driver,
  tenant-prefixed keys, signed URLs).
- App: landing → dev login → dashboard (completeness indicator) → **Brand
  Foundation editor** (story/voice/visual + asset uploads) → **public
  questionnaire** (`/q/[token]`) → **admin console** (create/invite/assign/archive
  + audit trail).

Partial / open: **P1-12** — the image-model choice and font-licence decisions
need the client's real assets (recorded in [`docs/decisions.md`](docs/decisions.md)).

**Next work starts at Phase 2** (see §6).

---

## 3. Run it locally

Prereqs: Node 24+, Docker Desktop running.

```bash
npm install
cp .env.example .env          # dev defaults already target the docker DB on :5544
npm run db:up                 # start Postgres (docker)
npm run db:migrate            # RLS role + schema + policies; clean from empty
npm run db:seed               # owner org + demo client + global prompt templates
npm run dev                   # http://localhost:3000
```

Verify anytime: `npm run typecheck` · `npm run lint` · `npm test` (unit +
cross-tenant isolation) · `npm run build`.

**Dev login:** `/login` lists seeded accounts. Sign in as **admin@huemen.studio**
(owner-admin) or **demo@client.test** (client). `db:seed` prints the exact ids.

---

## 4. Architecture map (where things live)

```
migrations/0001_core_schema.sql   14 core + support tables; every table has tenant_id
migrations/0002_rls.sql           ENABLE+FORCE RLS + tenant_isolation + scoped admin policies
src/db/pool.ts                    appPool (huemen_app, RLS-enforced) + adminPool (migrations)
src/db/session.ts                 withTenantSession — sets tenant GUCs per tx (USE THIS for every query)
src/db/migrate.ts, seed.ts        migration runner + seed
src/lib/env.ts                    zod-validated env (single source of config)
src/lib/context/                  context-builder (INV-2, pure+tested) + context-loader (DB)
src/lib/ai/                       facade (index.ts) + types + providers/mock — model choice is config
src/lib/storage/                  tenantKey(), signed URLs, local driver
src/lib/auth/                     getSession/devSignIn + scope.ts (resolveScope, adminGlobalScope)
src/lib/data/                     foundation.ts, admin.ts, assets.ts  (feature data access)
src/lib/invite/token.ts           questionnaire link HMAC token
src/app/                          UI: page(landing), login, dashboard/*, admin, q/[token], api/storage
tests/                            isolation.test.ts, storage.test.ts (+ context-builder.test.ts in src)
docs/                            architecture.md, decisions.md, phase-two.md
```

---

## 5. How to add a feature correctly (the pattern to copy)

Every feature task ships a **full vertical slice** (TASKS.md rule): data →
server action → UI screen → wired to context builder (if it generates) → covered
by a cross-tenant test. Copy the Brand Foundation slice — it's the reference:
[`data/foundation.ts`](src/lib/data/foundation.ts) +
[`foundation/actions.ts`](src/app/dashboard/foundation/actions.ts) +
[`foundation/page.tsx`](src/app/dashboard/foundation/page.tsx).

Rules that keep you inside the invariants:
1. **Every DB query goes through `withTenantSession(scope, ...)`.** Never query
   `appPool()` directly. Get `scope` from `resolveScope(session)` (or
   `adminGlobalScope(session)` for admin-global reads). Never trust a tenant id
   from the client — it comes from the verified session.
2. **Generation** = call the AI facade (`generateText`/`generateImage`), which
   assembles the prompt, logs to `generation_logs`, and retries. Load context via
   `loadBrandContext(scope)`. Stamp `prompt_version` (= `CONTEXT_VERSION`) on
   `content_items`.
3. **New tables** must have `tenant_id` and get RLS in a new numbered migration
   (mirror `0002`: ENABLE + FORCE + `tenant_isolation` policy; add `admin_all`
   only if it's a management/log table, never client content).
4. **Add a cross-tenant test** for any new data path (extend `tests/`).
5. **UI** uses the house-theme tokens/classes (`.eyebrow`, `.serif-accent`,
   `bg-ink`, `text-ink-muted`, `border-hairline`, `bg-accent`). Mark DB-reading
   pages `export const dynamic = "force-dynamic"`.
6. **White-label:** no Okra marks anywhere client-facing; no hardcoded hex.

---

## 6. Next work (Phase 2 — do in this order)

From TASKS.md. Phase 2 = AI wrapper is built (P2-1/2-3 largely done); build the
studios on top.

- **P2-2 Prompt template store** — resolve `prompt_templates` by key (per-tenant
  override → global fallback). Feed the resolved `systemTemplate` into
  `generateText`. Globals are already seeded.
- **P2-6…P2-10 Content Studio** — page at `src/app/dashboard/studio`. Formats
  (LinkedIn post/hook set, IG caption/carousel, newsletter, pitch email, talk
  abstract) → pick format + optional topic → `loadBrandContext` → `generateText`
  (2–3 variants) → inline edit → save `content_items` (stamp `prompt_version`).
  Voice guardrails: check output against `ctx.guardrails.dontWords`, FLAG in UI
  (don't auto-rewrite). Keep generation history in `content_generations`
  (regenerate-with-steer). Wire `ctx.degraded` messaging.
- **P2-11…P2-15 Visual Studio** — same screen as copy; brand-aware image prompts
  (append palette/style, negative prompts); **templated canvas** for
  carousels/quote-cards (real text overlay — image models misrender text);
  variants + per-channel export dims → `image_assets`.
- **P2-4 queue** — batch ops (carousels, later the 90-day calendar) go through
  the `jobs` table, not the request thread; show job status.

Then Phase 3 (calendar, strategy tools, idea inbox, repurposing, AEO, exports,
admin analytics/caps, white-label) and Phase 4 (DoD/handover). Full detail +
constraints + "Done when" checks are in TASKS.md — follow them per task.

---

## 7. Gotchas already discovered (save yourself the debugging)

- **DB port is 5544**, not 5432 — a native Postgres occupies 5432 on this machine.
  `docker-compose.yml` maps `5544:5432`; `.env` matches.
- **Postgres 18 image** needs the volume mounted at `/var/lib/postgresql` (not
  `/data`) — already fixed in compose. If you wipe data: `docker compose down -v`.
- **`server-only` guard**: it throws under `tsx` (scripts). DB primitives
  (`env.ts`, `pool.ts`, `session.ts`) and CLI-used modules deliberately omit it;
  feature modules keep it. Vitest aliases it to a stub
  ([`vitest.config.mts`](vitest.config.mts) → `tests/stubs/empty.ts`).
- **RLS needs a non-owner role**: the app connects as `huemen_app`
  (NOSUPERUSER/NOBYPASSRLS). Superusers bypass RLS even with FORCE — don't point
  `DATABASE_URL` at the owner.
- **Admin cross-tenant** access is a scoped `admin_all` RLS policy on
  management/log tables ONLY. Never add it to client-content tables.
- **Seed ids change** each `db:seed`; the login page looks users up live, so
  don't hardcode ids.
- **Dev login race**: after clicking a login button, let the POST/redirect settle
  (screenshot/read) before navigating elsewhere, or the cookie won't be set.
- **File-picker uploads** can't be automated in the preview browser — verify
  upload logic with a test (see `tests/storage.test.ts`), not the UI file dialog.
- `create-next-app` regenerates a Next.js block at the top of `AGENTS.md` and a
  `CLAUDE.md` (`@AGENTS.md`) — leave them; commit the block with your work.

---

## 8. Handover checklist not yet done (Phase 4 / DoD §11)

Track these; they are NOT complete: git repo + full history (this dir isn't a git
repo yet), real managed-auth provider (dev cookie adapter now), S3 storage driver
(local now), real AI providers + "no-training" setting recorded, image
re-encoding on upload (deferred to P4-1 security pass), rate limiting, custom
domain + full white-label pass, secrets rotation, ER diagram, phase-two list
finalised. See TASKS.md Phase 4.
