# Huemen.studio

Multi-tenant personal-brand OS. A brand is defined once; all copy and visuals are
generated from that stored context. Built for The Brand Professor.

**Start here:** [`AGENTS.md`](AGENTS.md) (what this is + the two invariants) ·
[`TASKS.md`](TASKS.md) (the build plan) · [`docs/architecture.md`](docs/architecture.md) ·
[`docs/phase-two.md`](docs/phase-two.md) (what is parked, and why).

> **Design system:** the client's own handoff, [docs/hueman-design-system-v1.html](docs/hueman-design-system-v1.html) — open it in a browser. It is normative: anything with a `--token` name or a `.hu-` class is built exactly, and it carries product rules as well as visual ones (44px targets, one primary action per view, what interface copy may and may not say). Our tokens and components follow it; see the decisions log for where and why we deviate.

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind 4 · Postgres 18 with Row-Level
Security · provider-agnostic AI layer (Claude; a stand-in writer for local work) ·
S3-compatible storage (AWS S3, Supabase Storage or R2) · email through Resend.
There is no job queue yet: every generation runs in the request.

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
npm run db:seed             # owner org, demo client workspaces, demo accounts

# 4. run
npm run dev                 # http://localhost:3000
```

In dev (`AUTH_DRIVER=dev`), `/login` lists the seeded accounts for one-click
sign-in and shows emailed links on screen. Production uses emailed one-time
links and invites (`AUTH_DRIVER=email`, Resend); there is no public sign-up, and
a production server refuses to start with the dev sign-in or the example secret.

## Scripts
| Script | Does |
|--------|------|
| `npm run dev` | Next dev server |
| `npm run build` / `start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest: unit, data and **cross-tenant isolation** tests (needs the database; in CI an unreachable database fails) |
| `npm run db:up` | Start local Postgres (docker) |
| `npm run db:migrate` | Apply migrations (clean from empty; re-runnable; works without superuser) |
| `npm run db:seed` | Seed owner org + demo workspaces |

Every migration has a rollback in `migrations/rollback/` (some undo the schema
only and say what data they cannot bring back).

## Environment
All config is in the environment (never in source). [`.env.example`](.env.example)
lists every variable with notes. Key ones: `DATABASE_URL` (RLS runtime role),
`DATABASE_ADMIN_URL` (migrations), `DATABASE_POOL_MAX`, `AUTH_SECRET`,
`AUTH_DRIVER`, `MAIL_PROVIDER`, `STORAGE_DRIVER`, `AI_TEXT_PROVIDER`, and the
per-minute AI limits. Invalid or unsafe combinations stop the server at start
with a plain message.

## Deploying
Hosting is always in the client's own accounts. A step-by-step test deploy on
Vercel + Supabase is in
[`HANDOVER-TEST-DEPLOY-Vercel-Supabase-Groq.md`](HANDOVER-TEST-DEPLOY-Vercel-Supabase-Groq.md).
For any host:
1. A private bucket with a CORS rule allowing PUT from the app's address (large uploads go browser to bucket).
2. A Resend sender on a verified domain (`MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`).
3. `AUTH_SECRET` of 32+ random characters; `AUTH_DRIVER=email`.
4. On serverless hosts, `DATABASE_POOL_MAX` 1 to 3 and the database's transaction pooler; raise the function time limit for long generations.
5. Point an uptime monitor at `GET /api/health` (200 when the database answers, 503 when not).
6. Set `CRON_SECRET` (16+ random characters) and call `GET /api/cron` every few minutes with `Authorization: Bearer <CRON_SECRET>` (see Background jobs).

## Background jobs
Work a person would wait more than ~10 seconds for runs in a queue
([`src/lib/jobs`](src/lib/jobs), the `jobs` table): today "Draft a piece from
every pillar" and "Generate 90 days". There is no always-on worker:
- a job starts right after the request that queued it (`after()` from
  `next/server`, inside the route's 300-second limit);
- while a page shows the job, its status poll (`GET /w/[id]/jobs/[jobId]`)
  starts a worker if the job is due or its worker has gone;
- `GET /api/cron` runs whatever is due, for retries nobody is watching. On
  Vercel, a Cron Job on that path sends the `Authorization: Bearer` header
  itself (Vercel's Hobby plan only allows daily crons; use Pro or any uptime
  pinger that can send a header). Without `CRON_SECRET` the route refuses
  every call.

A failure a retry could fix (the model timing out, a rate limit) waits and
tries again: 30 seconds, 2 minutes, 8 minutes, then up to 30 minutes, four
attempts in all, then the job is `dead`. The monthly cap, a setup error or
lost access stop it at once (`failed`). Either way the page says why, keeps
what was already made, and offers Try again, which carries on from there.
Each job runs as the person who started it, re-checked for access first.
To add a kind, write a handler in `src/lib/jobs/handlers.ts` that saves its
progress before each slow step.

## Tenant isolation (the one bug class we cannot ship)
Enforced by Postgres RLS on every table, keyed to the session tenant claim; the
app connects as a non-owner role so RLS always applies, and migrations refuse to
finish if that role could bypass it. Tests check it from three sides:
`tests/isolation.test.ts` (cross-tenant reads and writes fail),
`tests/security.test.ts` (every table has RLS enabled, forced and a policy, read
from the catalog; role reach), and `tests/endpoint-gates.test.ts` (every server
action and route checks a session, scope or signed link). They run in CI and
block merge. See [`docs/architecture.md`](docs/architecture.md).

## Editing prompt templates
Prompts are **data, not code** — rows in `prompt_templates`, versioned by `key`.
`tenant_id NULL` = a global template shared by all workspaces; a non-null
`tenant_id` is a per-tenant override. Editing/adding a version does not require a
redeploy, and the version used is stamped on each generated item for
traceability.

**Edit them in the app:** sign in as an owner-admin and open **Settings ›
Prompts**. Every template the studio resolves is listed with what it says today.
*Edit* opens an editor; *Save* writes a new version, used from the next draft
on, either for every workspace or for one workspace as an override ("Use the
global template here" removes an override). The history is in the same dialog
and any older version can be loaded and saved again. Each change is an
audit-log row (Settings › Audit log).

The built-in defaults live in [`src/lib/ai/template-defaults.ts`](src/lib/ai/template-defaults.ts)
and run (stamped as version 0) until a row exists. The output contract (the
shape the code parses back) is code-owned in [`src/lib/ai/prompt.ts`](src/lib/ai/prompt.ts)
and is appended after the template, so an edit can change how the model
writes but never break parsing.

## Admin (Settings, owner-admin only)
**Workspaces & access:** create, rename and archive client workspaces; set an
accent colour; invite clients (a client workspace takes clients only) and
coaches or admins (into your own organisation); assign and remove coaches; turn
a person's access off or on; revoke a pending invite; set monthly AI caps (empty
is unlimited, 0 switches drafting off). Changes take effect on the person's
next click. **Prompts** (above). **Audit log:** the last 60 admin changes.
**AI usage:** per workspace.

## App structure (UI)
A **workspace** is a tenant (one client, isolated by RLS). Its brand is set up
once and every piece is written from it:

- **Onboarding** (seven screens: website, name, audience, writing, look, words,
  first draft) and **Getting started** (voice pairs, rules, stories, pillars, more
  writing).
- **Brand core:** Brief (the one workspace brief, intake and questions), Voice
  (the Voice Pack: samples, measured voice, never-words, export), Pillars (a map),
  Visual (palette, fonts, logo, reference designs).
- **Create** (start a piece from a suggestion, an idea or a planned slot),
  **Check** (score any text against the voice and rewrite it), **Plan** (Ideas,
  a 90-day Calendar, Offers).
- **Library:** projects. A **project is one piece** and runs three steps that
  unlock in order: Ideate → Content (live drafting, history, steers, on-brand
  check) → Visual (templated post image, quote card and carousel with real text
  over brand colours, signed with the logo), then Export (PDF / Markdown).

Routes: `/w/[id]` home · `/w/[id]/onboarding` · `/w/[id]/setup` ·
`/w/[id]/brand/{edit,intake,questions,pillars,voice,visual}` · `/w/[id]/create` ·
`/w/[id]/check` · `/w/[id]/plan/{ideas,calendar,offers}` · `/w/[id]/usage` ·
`/w/[id]/p/[pid]/{ideate,content,visual,export}` (+ `/export/pdf`, `/export/markdown`) ·
`/settings/{connections,usage,workspaces,prompts,audit}` · `/q/[token]` (the
public pre-workshop questionnaire, 30-day links) · `/api/health`. The old
project-level brief, pillars and planning addresses redirect to the workspace
pages. Stage gates live in `projects.stage` and are enforced server-side
(`unlockStage` never skips).

## Repo map
```
migrations/        SQL migrations (schema + RLS), applied in order; rollback/ beside them
src/db/            pools, tenant-scoped session helper, migrate + seed
src/lib/env.ts     validated environment config and the production refusals
src/lib/context/   THE brand context builder (INV-2) + loader + tests
src/lib/ai/        provider-agnostic facade (caps, rate limits, logging), task registry, providers
src/lib/auth/      sessions, signed links, access-scope resolution
src/lib/storage/   tenant-prefixed storage (local or S3), direct uploads, file-type checks
src/lib/data/      data functions, all through withTenantSession (RLS)
src/app/           App Router UI, server actions and route handlers
tests/             isolation, security, endpoint gates and feature tests
docs/              architecture, decisions log, phase-two list, integrations
```
