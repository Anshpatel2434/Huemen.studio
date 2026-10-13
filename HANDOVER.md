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

**UI look**: the hueman design system v1 (`docs/hueman-design-system-v1.html`) supersedes AGENTS.md §3.5. Earlier: editorial, monochrome + one vermilion accent
(`#FF3429`), grotesque sans + serif-italic accent, uppercase micro-labels,
generous whitespace. All colours are CSS tokens in
[`globals.css`](src/app/globals.css) — never hardcode hex; per-tenant branding
overrides them. Translate the brand *feeling*, do NOT copy the marketing site's
scroll-jacking/animation.

---

## 2. Current state (2026-10-13, branch `voice-pack-v2`)

**Demo-ready on the mock provider; not production-ready.** 274 tests green,
CI green from a clean clone (migrate from empty, typecheck, lint, test, build).
`TASKS.md` was re-ticked from a code audit on 13 Oct; trust its dated notes
over its headings. The audit's parked items are in `docs/phase-two.md`.

Working, verified in the browser (13 Oct):
- Sign-in (dev driver) as admin, demo client or fresh client; passwordless
  pages, invite page, branded 404 and error pages.
- **Onboarding** (fresh client): five steps from About you to First draft, with
  pasted writing, uploads (PDF, Word, LinkedIn export, WhatsApp), links, voice
  confirmation, hue, first piece. Connections (Gmail, Docs, Calendar, YouTube,
  LinkedIn) are coded and switch on with credentials; untested against live APIs.
- **Studio** (demo client): Brand home, Create (topics from pillars), Check
  (deterministic score + model findings), Brand core (brief, voice pack page,
  pillars map, visual), Plan (ideas, calendar with the 90-day generator,
  offers), Library, Usage.
- **Project editor**: Ideate, Content (variants, steers, history, never-word
  flags, inline canvas editing), Visual (post image, quote card, carousel;
  PNG download at channel size, zip per piece), Export (PDF + Markdown).
- **Admin**: Settings > Workspaces & access (create, invite link, assign coach,
  archive, monthly AI caps), Settings > Prompts (versioned template editor),
  Settings > AI usage. All audited.

Not working outside `AUTH_DRIVER=dev`: sign-in, invites by email, file storage
on S3. No image model, no job queue, no rate limiting. See §8.

**Accounts after `npm run db:seed`:** `admin@huemen.studio` (owner-admin),
`demo@client.test` (finished client with pieces, pillars, caps),
`fresh@client.test` (walks onboarding from zero).

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

## 6. Next work (in this order)

1. **Make it run in production** (`docs/phase-two.md`, "Launch blockers"):
   a managed auth provider or a real email sender for the one-time links,
   the S3 storage driver, upload re-encoding. Nothing else can ship first.
2. **Run a real model.** Set `AI_TEXT_PROVIDER=anthropic` with the two model
   names and walk onboarding once with real writing; the mock has never been
   off. Never put a key in the repo or a message.
3. **Failed draft as a retryable state** (TASKS P2-3): save the request before
   the model call; show Retry, not a toast.
4. **Job queue** (P2-4) once more than a handful of clients run batches.
5. The proposal modules not started (strategy tools, AEO, repurposing, AI
   offer designer, image model, custom domain, full branding) after the client
   has been told and has chosen.

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

Not complete: managed auth or email sender (dev cookie adapter only), S3
driver, image re-encoding on upload, rate limiting, job queue, real AI provider
exercised + "no-training" setting recorded in the client's account, custom
domain + full white-label pass (only the accent colour is applied), secrets
rotation, ER diagram, README deployment section, HTTP-level cross-tenant tests,
observability. See `docs/phase-two.md` and TASKS.md Phase 4.
