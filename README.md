# Huemen.studio

Multi-tenant personal-brand OS. A brand is defined once; all copy and images are
generated from that stored context. Built for The Brand Professor.

**Start here:** [`AGENTS.md`](AGENTS.md) (what this is + the two invariants) ·
[`TASKS.md`](TASKS.md) (the build plan) · [`docs/architecture.md`](docs/architecture.md).

> **UI rebuild:** the Relume/Figma-style interface lives on the `ui` branch. See [docs/ui-branch.md](docs/ui-branch.md) for setup, a tour and rollbacks.

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind 4 · Postgres 18 (Row-Level
Security) · provider-agnostic AI layer · Postgres-backed job queue.

## Local setup

Prerequisites: Node 24+, Docker (for local Postgres). Postgres client optional.

```bash
# 1. install
npm install

# 2. configure — copy the example and keep it local (never commit .env)
cp .env.example .env        # dev defaults already point at the docker DB on :5544

# 3. start Postgres (docker), migrate, seed
npm run db:up
npm run db:migrate          # creates the RLS runtime role + schema + policies
npm run db:seed             # owner org + demo client workspace + global prompts

# 4. run
npm run dev                 # http://localhost:3000
```

In dev, `/login` lists seeded accounts (owner-admin and a demo client) to sign in
as. Production uses a managed auth provider + email invites (no public sign-up).

## Scripts
| Script | Does |
|--------|------|
| `npm run dev` | Next dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest — unit + **cross-tenant isolation** tests |
| `npm run db:up` | Start local Postgres (docker) |
| `npm run db:migrate` | Apply migrations (clean from empty) |
| `npm run db:seed` | Seed owner org + demo workspace |

## Environment
All config is in the environment (never in source). See
[`.env.example`](.env.example) for every variable with notes. Key ones:
`DATABASE_URL` (RLS runtime role), `DATABASE_ADMIN_URL` (migrations),
`AUTH_SECRET`, `STORAGE_DRIVER`, `AI_TEXT_PROVIDER` / `AI_IMAGE_PROVIDER`.

## Tenant isolation (the one bug class we cannot ship)
Enforced by Postgres RLS on every table, keyed to the session tenant claim; the
app connects as a non-owner role so RLS always applies. `tests/isolation.test.ts`
proves cross-tenant reads fail and runs in CI, blocking merge. See
[`docs/architecture.md`](docs/architecture.md).

## Editing prompt templates
Prompts are **data, not code** — rows in `prompt_templates`, versioned by `key`.
`tenant_id NULL` = a global template shared by all workspaces; a non-null
`tenant_id` is a per-tenant override. Editing/adding a version does not require a
redeploy, and the version used is stamped on each generated item for
traceability. (Admin UI for this: TASKS P3-10.) To seed/change globals now, edit
[`src/db/seed.ts`](src/db/seed.ts) or insert rows directly as an admin session.

## App structure (UI)
Workspace → projects → a Figma-style editor. A **workspace** is a tenant (one
client, isolated by RLS). It holds many **projects**; each project runs four
steps that unlock in order and are each generated from the one before:

1. **Brief**: intake (paste notes; labelled lines are parsed), the brief document,
   then **questions**. Gap questions fill missing brief fields; strategy
   questions seed the pillars.
2. **Pillars**: generated from the brief + answers (`pillar_set` template), shown
   as a map on the canvas; editable.
3. **Content**: drafted from each pillar (2 variants each, history + steers,
   don't-word flags).
4. **Visual**: templated visual sets (post image, quote card, carousel) with real
   text over brand colours, recorded in `image_assets`.

Routes: `/w/[id]` workspace home (projects grid) · `/w/[id]/usage` ·
`/w/[id]/p/[pid]/{intake,brief,brief/questions,brief/edit,pillars,content,visual}` ·
planning pages `ideas`, `calendar`, `offers` · `export` (+ `/export/markdown`).
Editor chrome: top bar with the step stepper, left panel (Pages + Layers, or the
Agent), canvas centre, step inspector on the right. Stage gates live in
`projects.stage` and are enforced server-side (`unlockStage` never skips).

## Repo map
```
migrations/        SQL migrations (schema + RLS), applied in order
src/db/            pools, tenant-scoped session helper, migrate + seed
src/lib/env.ts     validated environment config
src/lib/context/   THE brand context builder (INV-2) + loader + tests
src/lib/ai/        provider-agnostic text/image facade + mock providers
src/lib/storage/   tenant-prefixed object storage (local driver)
src/lib/auth/      session + access-scope resolution
src/app/           App Router UI (landing, dev login, dashboard shell)
tests/             cross-tenant isolation suite
docs/              architecture, decisions log, phase-two list
```
