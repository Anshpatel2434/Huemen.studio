<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — Huemen.studio (v1)

> **Read this file first.** It is the single orientation point for any AI agent or
> developer starting work in this directory. It tells you *what* is being built,
> *why* it is shaped the way it is, *what to read*, and *how to pick up the work*.
> The authoritative spec is [`Huemen_Studio_Internal_Build_Brief.pdf`](Huemen_Studio_Internal_Build_Brief.pdf).
> The ordered, checkable plan is [`TASKS.md`](TASKS.md).

---

## 1. What we are building

**Huemen.studio** is a multi-tenant SaaS "personal-brand OS", white-labelled to
**The Brand Professor** (client: Sahil Gandhi, UK & India). A personal brand is
defined **once**, and everything published from it — copy and images — is
generated from that stored context. Sahil runs it as his own product; his
coaching/workshop clients each get an **isolated workspace** inside it.

**The one idea the whole product rests on:** brand context is stored server-side
and injected into *every* generation, so nobody re-briefs an AI tool from
scratch. Get context storage + injection right and the rest is CRUD and UI. Get
it wrong and we have built "another wrapper."

### Three things that MUST be true at handover
1. A client can log in, fill their brand foundation **once**, and produce an
   on-brand LinkedIn post **and its image** without typing any brand context
   into a prompt.
2. **Two tenants cannot see each other's data under any query path.** This is the
   one bug class we cannot ship.
3. Sahil's team can create, provision and monitor client workspaces **without a
   developer touching the database**.

---

## 2. The two load-bearing invariants (never violate these)

These are repeated throughout `TASKS.md` because they are cross-cutting. Any
change that touches data access or generation must respect them.

### A. Tenant isolation is enforced at the database layer
- **Every** table carries `tenant_id` — no exceptions, including join tables and
  logs.
- Isolation is enforced with **Postgres Row-Level Security (RLS)**, keyed to the
  session tenant claim. Application-layer filtering is a *second* line of
  defence, **never the only one**.
- Storage keys are **tenant-prefixed**; signed URLs are scoped and short-lived.
- CI runs **automated cross-tenant read tests on every endpoint** and they must
  fail-to-read (i.e. deny). These **block merge**.

### B. One versioned context builder, called by every module
- `brand_profiles + voice_guides + visual_identities` compose into a **single
  serialised context block** via **one function, one output shape, versioned**.
- **Every module calls it. No module assembles its own context** — that is how
  voice drift starts.
- Every prompt is assembled as: **system template (from `prompt_templates`) +
  brand context block + task input**.
- Prompt templates are **data, not code** — versioned, admin-editable, and the
  version used is **stamped on every `content_item`** for traceability.

---

## 3. Architecture at a glance

Chosen for speed and for being **handover-friendly** (the client will own and run
this — nothing exotic, nothing that needs Okra to operate it).

| Layer | Approach |
|---|---|
| **Frontend** | Next.js (App Router) + TypeScript + Tailwind + a component library. Server actions for mutations; streaming for generation output. |
| **Backend** | Next.js API routes / server actions. Long-running generation (carousels, calendars) goes to a **background job queue**, not a request thread. |
| **Database** | Postgres with **RLS** for tenant isolation. Migrations checked into the repo. |
| **Auth** | Managed auth provider with organisation/tenant support and role claims. **Email-invite flow only** in v1 (no public sign-up). |
| **Storage** | Object storage for uploads + generated images. Signed URLs, **tenant-prefixed keys**. |
| **AI layer** | **Provider-agnostic wrapper**: one interface for text, one for image. Model choice + params live in **config, never hardcoded** in feature code. |
| **Jobs** | Queue for batch generation: retries with backoff, dead-letter handling, **visible job status in the UI**. |
| **Observability** | Structured logs, error tracking, `generation_logs` as the product-level audit trail. |

**Every model call writes a `generation_logs` row before returning. No silent
failures** — a failed generation is a visible, retryable state in the UI. Retry
and fallback policy is defined **once** at the wrapper level.

---

## 3.5 UI & design direction — house theme (read before building any screen)

The app is white-labelled to **The Brand Professor**, so *this* is the default
client-facing brand. Design language is derived from Sahil's own site
(sahil-gandhi.com): **premium, editorial, confident, monochrome-with-one-accent.**

> **Translate, don't transplant.** His marketing site is animation-heavy and
> scroll-jacking. Huemen.studio is a working tool (editors, forms, dashboards,
> streaming output). Keep the *brand feeling* — the type, the restraint, the
> confidence — and drop the marketing-site mechanics. Clarity and speed beat
> spectacle in-app. No scroll-hijacking, no giant watermark type behind working
> controls, no marquees inside the studio.

**Palette (default theme).** Per-tenant branding (`tenants.branding` JSON,
§4.7) can override these at runtime — build with CSS variables/tokens, never
hardcode hex in components.

| Token | Value | Use |
|---|---|---|
| `--ink` | `#000000` | Primary text, primary buttons, headlines |
| `--paper` | `#FFFFFF` | App background, cards |
| `--muted-surface` | `#F4F4F4` | Section fills, input backgrounds, hover states |
| `--ink-muted` | `#33373D` / `#69727D` | Secondary text, captions, meta |
| `--accent` | `#FF3429` (vermilion) | **Sparingly** — primary CTA, active state, key highlight, error/violation flags. Not decorative fills. |
| `--hairline` | `rgba(0,0,0,0.08)` | Borders, dividers, table rules |

Monochrome-first: black/white/off-white carry the UI; the vermilion is a single
punctuation accent, not a paint bucket. Ensure WCAG AA contrast on every text token.

**Typography.**
- **Display + UI:** a clean **grotesque sans** (his site uses *Borna*; use it if
  licensed for app/web embedding — otherwise a close free substitute like Inter,
  Söhne-alike, or Neue Haas Grotesk-alike). Weights 400–500; tight leading;
  **generous size contrast** — headlines large and calm, body quiet.
- **Serif-italic accent:** a serif used *italic, sparingly* for personality —
  page/section titles, the wordmark, an emphasised phrase. One accent per view,
  not everywhere. Confirm licensing before server-side use.
- **Micro-labels:** small, **UPPERCASE, letter-spaced**, often with an `↗` /
  arrow glyph for links and section eyebrows. This is a signature move — use it
  for nav items, tab labels, and metadata rows.

**Layout & feel.**
- **Whitespace is a feature.** Roomy padding, clear column structure, few boxes.
  Let content breathe rather than filling every pixel.
- **Flat and precise.** Minimal shadows, hairline borders, square-to-slightly-
  rounded corners. No heavy cards, no gradients, no skeuomorphism.
- **Editorial hierarchy.** One clear focal action per screen; strong type scale
  does the work that color/borders do in busier UIs.
- **Motion:** subtle and functional only — fades, streaming-text reveal, gentle
  state transitions. Never block interaction to animate.

**Voice in UI copy.** Confident, plain, a little cheeky — matching his brand
("Hope Your Strategy Has *Thick Skin.*"). Buttons and empty states speak like a
sharp brand consultant, not a generic SaaS. Keep it short.

**Component baseline.** Pick one headless/component library (per §3) and theme it
to the tokens above — do **not** ship its default look. Every color/font comes
from a token so the per-tenant white-label override (§4.7) works without touching
components.

**Where this applies vs. where it doesn't.** This is the **default house theme**
for The Brand Professor's own chrome and any workspace without custom branding.
A tenant that sets its own palette/logo/fonts overrides the chrome for *its*
workspace. Note: `visual_identities` (used to prompt **image generation**) is a
separate concern from **app-chrome theming** — don't conflate them.

---

## 4. Roles

| Role | Who | Can do |
|---|---|---|
| **Owner / Admin** | Sahil + team | Create/archive workspaces, invite users, view all workspaces, manage branding + global prompt templates, view usage analytics. |
| **Coach** | Sahil's team members | Access *assigned* client workspaces, edit brand foundation + content on the client's behalf. **Cannot** manage billing-level settings or other coaches' clients. |
| **Client** | Workshop / cohort / 1:1 clients | Access **their own workspace only** — brand foundation, content studio, visual studio, calendar, idea inbox, offers, exports. |

Client accounts are **admin-provisioned** in v1. There is no public sign-up (deliberate — removes onboarding/verification/abuse scope from a 3-week build).

---

## 5. Data model (core objects)

Every table carries `tenant_id`. See brief §03 for full column notes.

`tenants`, `users`, `brand_profiles`, `voice_guides`, `visual_identities`,
`assets`, `pillars`, `content_items`, `image_assets`, `ideas`,
`calendar_entries`, `offers`, `prompt_templates`, `generation_logs`.

---

## 6. What to read, in what order

1. **This file** (`AGENTS.md`) — orientation + invariants.
1b. **§3.5 UI & design direction** (above) — read before building any screen.
2. [`Huemen_Studio_Internal_Build_Brief.pdf`](Huemen_Studio_Internal_Build_Brief.pdf) — the authoritative spec. Sections:
   01 Objective · 02 Users/Roles · 03 Data model · 04 Modules · 05 Architecture ·
   06 Build sequence · 07 Non-functional reqs · 08 Scope boundary ·
   09 Open decisions · 10 Risks · 11 Definition of Done.
3. [`TASKS.md`](TASKS.md) — the ordered, phased, checkable plan. **This is your
   worklist.** Do tasks in order; do not skip ahead past a blocking task.
4. (Once code exists) `README.md`, `/docs/architecture.md`, and the migrations
   directory.

---

## 7. How to start / continue work in this directory

1. Open [`TASKS.md`](TASKS.md). Find the **first unchecked task** in the lowest
   incomplete phase. Phases are ordered by dependency — **do not start a later
   phase's task while an earlier blocking task is open.**
2. Before writing code that touches data access or generation, re-read §2 above
   (the two invariants). If your change would let a module assemble its own
   context, or read data without an RLS-backed tenant scope, **stop** — it is
   wrong by construction.
3. Implement the task to satisfy **all** its "Constraints" and pass **all** its
   "Checks / Done when" lines. A task is done only when every check is true.
4. Tick the box in `TASKS.md`, add a one-line note if a decision was made, and
   move to the next task.
5. **Documentation is written as you go, not retrofitted** (brief §10). Update
   `README.md` / `/docs` in the same change that introduces the feature.
6. When an **open decision** (brief §09, mirrored in `TASKS.md` Phase 1) is
   settled, record the decision inline in `TASKS.md` and in `/docs` — do not
   leave it implicit in code.

### Ground rules that never change
- **RLS from the first table**, not bolted on later.
- **Secrets in environment config only** — never in the repo or its history.
- **No Okra Tech Labs marks** in any client-facing surface (emails, page titles,
  favicons, error pages, PDF exports).
- **Client data is never used for model training/evaluation** — configure
  providers accordingly and record the setting.
- Anything not started by its week is a **scope conversation, not an overtime
  problem**. Parked items go on the **phase-two list**, and the client is told
  the same day — never silently absorbed.

---

## 8. Scope boundary (NOT in v1 — do not build)

Video gen/editing · Direct publishing to LinkedIn/Instagram APIs · Client
self-serve sign-up + subscription billing · Native mobile apps (responsive web
only) · Paid-ads creative / landing pages / CRM · Analytics on published-post
performance. These are **deferred, not cancelled** → phase-two list.

---

## 9. Status & conventions

- **Status:** v1.0 living document. Update `TASKS.md` and this file in-repo as
  decisions land.
- **Build window:** 3 weeks from kick-off; weekly preview at the end of each week
  (preview points, not hard gates).
- **Definition of Done** is the real finish line — see `TASKS.md` Phase 4. "The
  build is complete when every line is true, not when the last feature merges."
- **Stack note:** this is a fresh Next.js (App Router) scaffold — read the version
  notes in the Next.js block at the top of this file before writing framework code.
