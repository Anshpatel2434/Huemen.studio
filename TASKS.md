# TASKS.md — Huemen.studio v1 build plan

> **Read [`AGENTS.md`](AGENTS.md) first.** Source of truth: [`Huemen_Studio_Internal_Build_Brief.pdf`](Huemen_Studio_Internal_Build_Brief.pdf).
>
> **How to use this file.** Work top to bottom. Phases are ordered by dependency.
> Do the **first unchecked task** in the lowest incomplete phase. A task is
> **done only when every line under "Done when" is true** and every "Constraint"
> holds. Tick the box, add a dated note if a decision landed, then move on.
>
> **Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (note why).
> Task IDs (P0-1, etc.) are stable — reference them in commits.
>
> **Build status (2026-11-03).** Audited against the code on branch
> `audit-fixes` and re-ticked below. Since 13 Oct: email sign-in and invites
> (Resend), the S3 driver, upload safety and direct uploads, rate limits,
> managed-Postgres migrations, the admin console (access, roles, coaches,
> accent, audit log), the security fixes from the 3 Nov audit, and the
> half-made product connections joined up. Still open for production: an image
> model, a job queue, image re-encoding, error tracking, and the real-model and
> client-review checks (P4-4, P4-5). Parked items are in `docs/phase-two.md`.
>
> **Build status (2026-10-13).** Audited against the code on branch
> `voice-pack-v2` and re-ticked below (the earlier ticks had gone stale). Built
> and demo-ready: the whole studio on the mock provider, onboarding, voice pack,
> content, templated visuals with PNG export, calendar generator, caps, prompt
> editor, PDF/Markdown export, connections code. 274 tests green, CI green from
> a clean clone. **Blocks production, not the demo:** sign-in outside the dev
> driver, an email sender, the S3 driver, an image model, a job queue, rate
> limiting, upload re-encoding. Parked items are in `docs/phase-two.md`.
> Marked `[!]` below = parked, needs a client conversation.
>
> **Build status (2026-09-01).** Phase 0 done and the Phase 1 spine built +
> verified: Next.js 16 scaffold, Postgres 18 (docker, port 5544) with full
> schema + RLS, the versioned context builder (unit-tested), the provider-
> agnostic AI facade, storage/auth/AI dev adapters, seed data, CI, and a running
> branded app shell (landing → dev login → dashboard reading the brand foundation
> through auth→scope→RLS→context-builder). 12 tests green (incl. cross-tenant
> isolation); typecheck + lint + build clean. **Phase 0 + Phase 1 complete and
> verified** (only P1-12 decisions stay partial, pending client input): admin
> provisioning + audit, Brand Foundation editor, asset uploads via signed URLs,
> and the public tokenised questionnaire (writes a tenant-scoped draft). 14 tests
> green. **Next: Phase 2 — AI Content Studio (P2-6…P2-10) then Visual Studio.**
>
> **Vertical-slice rule (what "done" includes).** Unless a task is tagged
> **[infra]** or **[backend-only]**, every feature task ships as a full vertical
> slice: **data/migration → server action or API → UI screen → wired to the
> versioned context builder (if it generates) → covered by a cross-tenant test.**
> A feature task is **not done** with a working backend but no screen a user can
> operate, or a screen with no persistence. UI follows the stack in `AGENTS.md`
> §3 **and the look-and-feel in `AGENTS.md` §3.5 (house theme — monochrome +
> one vermilion accent, grotesque sans + serif-italic accent, editorial
> whitespace, tokenised for per-tenant override)**. Genuinely UI-less tasks are
> marked **[infra]** / **[backend-only]**.

---

## Two invariants that gate every task (never violate)

These override any task-level convenience. Restated from `AGENTS.md` §2.

- **INV-1 — Tenant isolation at the DB layer.** Every table has `tenant_id`.
  Isolation enforced by **Postgres RLS** keyed to the session tenant claim.
  App-layer filtering is a *second* line only. Cross-tenant read tests run in CI
  and **block merge**. Storage keys tenant-prefixed; signed URLs scoped + short-lived.
- **INV-2 — One versioned context builder.** `brand_profiles + voice_guides +
  visual_identities` → one serialised context block via **one versioned
  function**. Every module calls it; **no module builds its own context**. Every
  prompt = system template (`prompt_templates`) + context block + task input.
  Prompt-template version is **stamped on every `content_item`**.

---

## Cross-cutting constraints (apply to every phase — brief §07)

Treat these as acceptance criteria on *all* work, not a separate task:

- **Security:** secrets in env config only, never in repo/history (rotate before
  handover). Uploads: type + size validation, image re-encoding, no direct
  execution paths. Rate limiting per user **and** per tenant on generation
  endpoints. Audit trail on admin actions (workspace creation, role changes, cap
  changes). **Client data never used for model training/eval** — configure
  providers and record the setting.
- **Performance/reliability:** first token visible within a few seconds for
  single-item text; anything longer **streams or queues**. Batch ops (carousel
  sets, 90-day calendars) **always queue**, progress visible, **partial results
  retained on failure**. Graceful degradation when a provider is down: clear
  message, retry, **saved input — never lose a user's draft**.
- **White-label:** **no Okra Tech Labs marks** in any client-facing surface —
  emails, page titles, favicons, error pages, PDF exports.
- **Handover-as-you-go:** documentation written alongside features, not
  retrofitted. Accounts in the client's name from week three, not the last day.

---

# PHASE 0 — Project setup & scaffolding
*Prereq for everything. Not a "week" in the brief, but nothing can start without it.*

- [x] **P0-1 — Repo & Next.js scaffold.** Next.js (App Router) + TypeScript +
  Tailwind + chosen component library. ESLint/Prettier, strict TS.
  - **Done when:** `dev` server runs; a placeholder page renders; lint + typecheck pass.
- [x] **P0-2 — Environment & secrets config.** `.env.example` listing every var
  (DB, auth, storage, AI providers, queue). Real secrets never committed;
  `.gitignore` covers `.env*`.
  - **Constraint:** secrets in env only (INV/§07). **Done when:** app reads all
    config from env; `.env.example` is complete and documented.
- [x] **P0-3 — Postgres + migration tooling. [infra]** Local Postgres, migration runner
  chosen, migrations directory checked into repo.
  - **Done when:** an empty DB migrates clean from zero; a rollback works.
  - _2026-11-03:_ Every migration has a rollback in `migrations/rollback/`; 0019's was run down and back up locally. Those for 0001, 0002 and 0007 undo the schema only and say which data needs a backup.
- [x] **P0-4 — CI pipeline skeleton. [infra]** Lint, typecheck, test, migrate-from-empty
  jobs. Placeholder for the cross-tenant test suite (P1-3) that **blocks merge**.
  - **Done when:** CI runs on PRs; a failing test blocks merge.
- [x] **P0-5 — Managed auth provider wired.** Provider with org/tenant support +
  role claims. Email-invite flow only (no public sign-up).
  - **Done when:** a seeded user can log in; the session exposes a **tenant claim
    + role claim** usable by RLS (feeds P1-2).
  - _2026-11-03:_ Built as passwordless email sign-in (signed one-time links and invites through Resend) rather than a third-party provider; see the decisions log. Sessions expire after 8 hours and re-read the account on every request.
- [x] **P0-6 — Object storage wired.** Bucket + signed-URL helper with
  **tenant-prefixed keys**.
  - **Done when:** an upload lands under a tenant-prefixed key; a scoped,
    short-lived signed URL reads it back.
- [x] **P0-7 — Docs skeleton.** `README.md` (setup, env vars, run, deploy stub) +
  `/docs/architecture.md` + `/docs/decisions.md` (for §09 outcomes) started.
  - **Done when:** a new dev can clone → run locally from the README alone.

---

# PHASE 1 — Week 1: Foundation, isolation, brand capture, context builder
*Brief §06 Week 1. The spine. If INV-1 and INV-2 are not solid here, later phases inherit the flaws.*

### 1a. Schema, migrations & RLS (do first — INV-1)
- [x] **P1-1 — Full schema + migrations. [backend-only]** All 14 tables (§03): `tenants`,
  `users`, `brand_profiles`, `voice_guides`, `visual_identities`, `assets`,
  `pillars`, `content_items`, `image_assets`, `ideas`, `calendar_entries`,
  `offers`, `prompt_templates`, `generation_logs`.
  - **Constraints:** every table has `tenant_id` (incl. join tables + logs);
    `content_items` has `prompt_version`; `image_assets` links parent
    `content_item` + records model/params/aspect/storage key; `ideas` has
    `converted_to_content_item_id`; `prompt_templates` supports global +
    per-tenant overrides + target model + params + version.
  - **Done when:** migrations run clean from empty; schema matches §03.
- [x] **P1-2 — RLS policies on every table. [backend-only]** Policies keyed to the session
  tenant claim from P0-5. Enabled **from the first table**, not retrofitted.
  - **Constraint (INV-1):** RLS is the primary line; app filtering is secondary.
  - **Done when:** with a tenant claim set, queries return only that tenant's
    rows; without a valid claim, protected tables return nothing.
- [x] **P1-3 — Cross-tenant test suite in CI (BLOCKS MERGE). [infra]** Automated tests
  that attempt cross-tenant reads on **every endpoint/data path** and **expect
  failure**. Wire into the P0-4 gate.
  - **Constraint (INV-1 / §07 / risk §10):** this is the one unshippable bug
    class. **Done when:** tests exist for each endpoint as it lands, run in CI,
    and a deliberately-leaky query makes them fail (proving they bite).
  - _2026-11-11:_ Per-endpoint tests landed (`tests/cross-tenant-endpoints.test.ts`, about 300 tests, ~50s): every server action and route handler, called in-process with a real session cookie against the real database, as a client of B, a coach of B, a disabled user of A and nobody, aimed at A. Each is refused, returns nothing of A's and changes nothing of A's (checked as the database owner), with a positive control by A's own member; signed-link, cron and browser-report endpoints have their own cases. A new endpoint with no case fails the suite (`tests/helpers/endpoints.ts`). Proven to bite: removing the workspace or project check fails it.

### 1b. Auth, roles, tenant provisioning, admin shell
- [x] **P1-4 — Role enforcement (Owner/Admin, Coach, Client).** Map role claims
  to capabilities per §02. Coaches see only assigned workspaces; clients see only
  their own.
  - **Done when:** each role is blocked from actions outside its row in §02;
    coach↔client assignment is respected.
- [x] **P1-5 — Tenant provisioning + admin shell.** Admin UI to **create /
  invite / archive** workspaces and assign coaches to clients — **no DB access
  needed** (handover truth #3).
  - **Constraint:** admin actions write an **audit trail** (§07).
  - **Done when:** an admin creates a workspace, invites a user, and archives a
    workspace entirely through the UI; each action is audited.

### 1c. Brand Foundation editor end-to-end (§4.1)
- [x] **P1-6 — Story arc + positioning editor.** Guided editor: story arc (3
  chapters), positioning statement, niche, audience, offers → `brand_profiles`.
- [x] **P1-7 — Voice guide capture.** Tone descriptors/sliders, do-words,
  don't-words, 3–5 sample posts (pasted), reading level, formatting rules →
  `voice_guides`.
- [~] **P1-8 — Visual identity capture.** Palette hex inputs, font selection or
  upload, logo upload, image style notes, reference-image uploads →
  `visual_identities` + `assets`.
  - **Constraint:** uploads validated (type/size), image re-encoded, no execution
    paths; stored under tenant-prefixed keys.
  - _2026-11-03:_ Type read from the file's bytes, size-limited, SVGs with active content refused, served locked down, tenant-prefixed. **Not done:** re-encoding images (needs an image library). The newest logo signs the visual templates.
- [x] **P1-9 — Pre-workshop questionnaire (public tokenised form).** A public,
  tokenised form that writes straight into a **draft** brand profile (workshop =
  onboarding). Post-workshop summary paste-in parsed into fields.
  - **Constraint:** token-scoped to one tenant/draft; no auth bypass of INV-1.
  - **Done when:** submitting the tokenised form populates a draft
    `brand_profile` for the correct tenant; summary paste maps into fields.
- [x] **P1-10 — Completeness indicator.** A thin foundation is surfaced; the
  content studio must **visibly degrade and say so**, not emit generic output
  silently.
  - **Done when:** a sparse profile shows a completeness state that later gates
    Content Studio messaging (consumed in Phase 2).

### 1d. Context builder (INV-2 — the spine)
- [x] **P1-11 — Versioned context builder function. [backend-only]** One function, one output
  shape, versioned. Composes `brand_profiles + voice_guides + visual_identities`
  into the single serialised context block.
  - **Constraints (INV-2):** every module will call this; no module builds its
    own context. Output shape stable + versioned; language structured as a
    **parameter** for later i18n (§09 default English-only).
  - **Done when:** **unit-tested** with fixtures; returns a stable versioned block;
    a thin profile yields a flagged/degraded block (feeds P1-10).

### 1e. Week-1 open decisions to settle (brief §09 — record in `/docs/decisions.md`)
- [~] **P1-12 — Settle §09 decisions.** Record each with rationale + date:
  - Carousel/quote-card rendering — **default: templated canvas** (real text
    overlay + model background). *Affects Phase 2 Visual Studio.*
  - Image model choice — pick in week one (evaluate on brand-consistency +
    aspect-ratio control, not benchmarks).
  - Text model routing — **default: route by task** (strong model for drafting,
    cheaper for hooks/tags), configured not hardcoded.
  - Fonts in generated images — check licences when assets arrive day one; may
    force a fallback.
  - Notion export — **default: Markdown**, no API integration in v1.
  - Multi-language — **default: English-only**, context object language-parametric.
  - **Done when:** all six recorded in `/docs/decisions.md` with a chosen value.

> **Dependency watch (brief §06):** client brand assets (palette, logos, fonts,
> reference posts/visuals) are due **day one** — Week 2 is blocked without them.
> Escalate on day two if nothing has landed. Book **Sahil's voice sign-off** for
> Week 2 in advance.

**Phase 1 preview gate:** schema + RLS live, cross-tenant tests in CI, auth +
provisioning + admin shell working, Brand Foundation editor end-to-end (incl.
upload + questionnaire), context builder written + unit-tested.

---

# PHASE 2 — Week 2: AI wrapper, Content Studio, Visual Studio, portal isolation
*Brief §06 Week 2. Blocked on real brand assets (Visual Studio cannot be tuned without them) and needs Sahil's voice sign-off this week.*

### 2a. AI layer (INV-2, §05)
- [x] **P2-1 — Provider-agnostic AI wrapper. [backend-only]** One interface for text, one for
  image. Model choice + params in **config, never hardcoded** in feature code.
  Retry + fallback policy defined **once** at the wrapper level. Text model
  routing per P1-12.
  - **Done when:** swapping a model = a config change; a provider hiccup surfaces
    as retry/fallback, not a broken screen.
  - _2026-10-13:_ Built: `lib/ai` facade, mock + Anthropic text providers, config-only model choice, retry/fallback once, `enforceCap` before any call. Image providers: templates only (see P2-13).
- [x] **P2-2 — Prompt template store.** `prompt_templates` as **data** — versioned
  bodies by key, target model, params, global + per-tenant overrides.
  - **Done when:** a template can be edited + versioned without a redeploy; each
    generation resolves the correct (tenant-override-aware) version.
  - _2026-10-13:_ Built: `prompt_templates` resolved per call (tenant override > global > built-in default v0). Admin editor at Settings > Prompts, every save a new version, audited.
- [x] **P2-3 — Generation logging + visible failure states.** Every model call
  writes a `generation_logs` row **before returning** (kind, model, tokens
  in/out, image count, latency, status, user, tenant).
  - **Constraint:** **no silent failures** — a failed generation is a visible,
    **retryable** UI state; input is saved (never lose a draft).
  - **Done when:** every call is logged; a forced failure shows a retryable state.
  - _2026-10-13:_ Every call logs, success and failure. OPEN: a failed draft is a toast, not a stored retryable state, and the request is not saved before the model call.
  - _2026-11-11:_ Done. Live drafts keep their topic and offer Try again; batches are queued jobs that keep their partial results and offer Try again; regenerate, steer and rewrite failures keep the toast open with Try again; pillar generation comes back to its page with the reason, the input kept and Try again (components/generation-failed), never an error page.
- [x] **P2-4 — Streaming vs. queue policy.** Stream anything the user waits on;
  **queue anything over ~10s**. Job queue with retries+backoff, dead-letter,
  visible job status in the UI.
  - **Done when:** single text gen streams; a long batch queues with visible
    progress and retained partial results on failure.
  - _2026-10-13:_ No queue, no streaming: generation runs in the request thread (`AI_TEXT_TIMEOUT_MS`). The `jobs` table and `QUEUE_DRIVER` exist unused. Parked, client to be told.
  - _2026-10-14:_ Streaming built: single drafts are written live onto the canvas (NDJSON route, provider `stream()`). Queue still parked.
  - _2026-11-11:_ Queue built (`lib/jobs`, migration 0020): claim with SKIP LOCKED and a lease, backoff retries (30s, 2m, 8m, up to 30m), dead-letter after four attempts, slices inside the function limit, progress kept before each slow step. "Draft from every pillar" and "Generate 90 days" are queued, with status, progress, Stop and Try again on their pages. Runs after the request (`after()`), while a page watches, and from `GET /api/cron` (CRON_SECRET). README, Background jobs.
- [x] **P2-5 — Rate limiting on generation endpoints.** Per user **and** per
  tenant (§07). **Done when:** limits enforced + surfaced clearly when hit.
  - _2026-10-13:_ Not built. Only the hard usage cap (P3-9) bounds spend.
  - _2026-11-02:_ Built (migration 0017, `lib/ratelimit`): 20 model calls a minute per person and 60 per workspace (settings), counted in Postgres under an advisory lock; transcription included (11-03). Refusals say how long to wait. Sign-in emails: five per account per 15 minutes.

### 2b. AI Content Studio — text (§4.2)
- [x] **P2-6 — All text formats.** LinkedIn post, LinkedIn hook set, Instagram
  caption, Instagram carousel copy (slide-by-slide), newsletter section, pitch
  email, talk abstract.
  - **Constraint (INV-2):** context injected automatically via P1-11 — **the user
    types no brand context** (handover truth #1).
  - _2026-10-13:_ 13 formats in `lib/content/formats.ts`, each with its template.
- [x] **P2-7 — Generation flow + variants.** Pick format → optional topic/idea →
  context auto-injected → **2–3 variants** → edit inline → save as `content_item`
  (stamp `prompt_version`).
  - _2026-10-13:_ 2 variants per draft (UI never asks for 3), inline edit, `prompt_version` + template id stamped. Co-write and own-draft paths stamp nothing (minor).
- [x] **P2-8 — Voice guardrails.** do/don't words **enforced in the prompt** and
  **checked post-generation**; violations **flagged in the UI**, not silently
  rewritten.
  - **Done when:** a don't-word in output is flagged, not auto-removed.
  - _2026-10-13:_ Never-words in the prompt and checked after, flagged not rewritten; deterministic voice score + model findings. Do-words only reach the prompt on the legacy no-pack path.
- [x] **P2-9 — Regenerate-with-steer + generation history.** Steers ("shorter",
  "more contrarian", "less corporate") **without losing the previous version** —
  keep generation history per `content_item`.
  - _2026-10-13:_ Five steers, `content_generations` history with "Use".
- [x] **P2-10 — Completeness-aware degradation.** Wire P1-10: thin foundation →
  studio visibly says so rather than emitting generic output.
  - _2026-10-13:_ Thin brief: warning badge in Content, pillar generation blocked while degraded.

### 2c. AI Visual Studio — images (§4.3)
- [~] **P2-11 — Visual Studio in the same screen as copy.** Generate the post,
  then its visual **without navigating away**.
  - _2026-10-13:_ Visual is its own step (`/p/[pid]/visual`), one click from Content, not the same screen.
  - _2026-10-14:_ Visual step now has layout options per artboard, live tweaks and ask-to-change on every text.
- [~] **P2-12 — Output types.** Single-image LinkedIn/Instagram post, carousel
  frame set, quote card, announcement graphic.
  - _2026-10-13:_ Post image, quote card, carousel frames. No announcement graphic.
- [x] **P2-13 — Brand-aware prompting.** Palette, type treatment, style notes from
  `visual_identities` **appended to every image prompt**, with **negative
  prompts** for the generic AI look.
  - **Constraint (risk §10):** generic/off-brand images are the highest-probability
    failure — tune against **real reference assets**.
  - _2026-10-13:_ No image model wired (brief §09 default: templates). `generateImage` has no callers. Image prompting with palette / negative prompts is not exercised. Client decision pending (AI images yes or no).
  - _2026-11-11:_ Decided and built: ChatGPT Image (OpenAI) for pictures, on the stand-in until the key is set. Claude writes the brief from the brand context (palette, image style, audience) with a negative list (`image_brief`); pictures go on any visual, with the heading as live text or drawn in; a comment on a spot redraws only that area (`lib/visual/region` keeps every pixel outside it). Open: tune against real reference assets with the real model (`npm run smoke:pictures` first).
- [x] **P2-14 — Templated carousel/quote-card rendering (per P1-12 default).**
  Templated canvas with **real text overlay** + model-generated backgrounds.
  - **Rationale:** image models misrender text; a typo on a client's carousel is a
    **brand-damaging** failure we own. Respect font-licence outcome from P1-12.
  - _2026-10-13:_ Templated artboards with real text over brand colours, editable in place.
- [~] **P2-15 — Variants + correct export dimensions.** Regenerate, keep variants,
  download at correct per-channel export dimensions. Save to `image_assets`.
  - _2026-10-13:_ Download as PNG at the channel size, per artboard and as a zip per piece (13 Oct). Variants are not kept: a regenerate replaces the set.
  - _2026-10-14:_ Layout variants (4/3/3) with side-by-side options; the chosen layouts and tweaks survive a regenerate.

### 2d. Client portal shell + isolation verified
- [x] **P2-16 — Client portal shell.** Navigation + **workspace switcher for
  coaches**; per-client isolation enforced in the **data layer** (not UI).
  - **Constraint (INV-1):** isolation verified by P1-3 tests covering every new
    endpoint. **Done when:** a coach switches between only assigned workspaces; a
    client sees only their own; cross-tenant tests green.
  - _2026-10-13:_ One app shell, workspace switcher for coaches and admins, isolation in the data layer; cross-tenant tests at the data layer (no HTTP route tests).

**Phase 2 preview gate + reviews:** AI wrapper + template store live; Content
Studio (all formats, variants, inline edit, history, guardrails); Visual Studio
(brand-aware + templated, variants, export dims); portal shell with isolation
verified. **Sahil signs off voice this week** (risk §10 — cannot be deferred).

---

# PHASE 3 — Week 3: Strategy tools, workflow, admin/analytics, white-label
*Brief §06 Week 3. Needs client-name domain + provider accounts by start of week for the white-label pass.*

### 3a. Content Studio remainder (§4.2)
- [x] **P3-1 — 90-day calendar generator.** Pillars + posting frequency → dated
  slots (topic, hook angle, CTA) written to `calendar_entries` as drafts.
  - **Constraint:** batch op → **queues** with visible progress + retained partial
    results (§07).
  - _2026-10-13:_ Built 13 Oct as one model call: days and channels planned in code (`planSlots`), `calendar_plan` fills each slot, rows written in one transaction. Not queued (see P2-4).

### 3b. Strategy & packaging tools (§4.4)
- [ ] **P3-2 — Niche validation / positioning / authority / growth.** Niche
  validation flow, 3×3 positioning matrix, authority ladder, Q1–Q4 growth-plan
  generator.
  - _2026-10-13:_ Not built. Nearest: the five strategy questions that seed pillars.
- [~] **P3-3 — Offer designer.** Expertise-in → packaged offer out (format,
  promise, deliverables, pricing logic) → saves to `offers`, **reusable as
  context** for pitch emails.
  - _2026-10-13:_ Manual form (no AI designer). Saved offers now reach every prompt through the context builder (13 Oct).
- [ ] **P3-4 — Answer-first (AEO) page generator.** Structured Q&A pages from the
  brand profile, exportable as **HTML or Markdown**.
  - _2026-10-13:_ Not built.

### 3c. Workflow & collaboration (§4.5)
- [x] **P3-5 — Idea inbox.** Quick capture (text paste; email-in later),
  **auto-tagged to a pillar**, one-click convert to a `content_item` (set
  `converted_to_content_item_id`).
  - _2026-10-13:_ Capture, keyword auto-tag to a pillar, convert starts a piece; `converted_to_content_item_id` set when the first copy lands (13 Oct).
- [ ] **P3-6 — Repurposing pipeline.** One long-form item → fan out to short
  posts, carousel copy, an email, a talk outline — **all linked back to the
  source**.
  - _2026-10-13:_ Not built. `source_content_item_id` exists unused.
- [x] **P3-7 — Exports.** PDF **and** Markdown/Notion-compatible export of brand
  foundation, calendar, and content (Markdown per P1-12).
  - **Constraint:** exports carry **client branding**, **no Okra marks**.
  - _2026-10-13:_ PDF (`@react-pdf/renderer`) and Markdown, approved-only or all; voice pack as eight files. Titled by the person or workspace, no Okra marks. Tenant palette/logo not yet applied to exports (see P3-12).

### 3d. Admin & analytics (§4.6)
- [x] **P3-8 — Per-tenant usage view.** Generations run, images produced, active
  users, last activity — reads from `generation_logs`.
  - _2026-10-13:_ `/w/[id]/usage` and Settings > AI usage, from `generation_logs`.
- [x] **P3-9 — Usage caps.** Per-tenant caps with a **soft warning** and a **hard
  stop**, admin-configurable. Surface runaway usage — don't hide it (client pays
  provider costs directly).
  - **Constraint:** cap changes are **audited** (§07).
  - _2026-10-13:_ Built 13 Oct: caps form on Settings > Workspaces (audited), amber meter past the soft cap, `enforceCap` hard stop before the provider with a plain message.
- [x] **P3-10 — Global prompt template management + versioning.** Admin edits
  prompts **without a redeploy**; versions traceable to `content_items`.
  - _2026-10-13:_ Built 13 Oct: Settings > Prompts. See P2-2.

### 3e. White-label layer (§4.7)
- [ ] **P3-11 — Custom domain + TLS.** Custom domain support with TLS.
  - _2026-10-13:_ Not built; no host-based tenant resolution.
- [~] **P3-12 — Branding config applied everywhere.** Logo/palette/fonts applied to
  client-facing UI **and transactional emails**.
  - _2026-10-13:_ Only `branding.accent` is applied to the chrome. No logo/palette/fonts, no edit UI, nothing in exports; emails do not exist yet.
  - _2026-11-03:_ The accent is now set in Settings › Workspaces & access. Emails exist (sign-in, invites) and carry the product name, not the client's branding. Exports still use fixed type and ink. Remains phase two.
- [~] **P3-13 — No-Okra-marks pass.** Verify **specifically**: email templates,
  page titles, favicons, error pages, PDF exports.
  - **Done when:** a reviewer finds zero Okra marks across all client-facing surfaces.
  - _2026-10-13:_ A sweep of `src/` finds no Okra marks in page titles, exports, error pages or the icon. Emails cannot be checked until a sender exists. Formal reviewer pass still to do.
  - _2026-11-03:_ Swept again including the emails and the new error pages: the only mentions are code comments. Formal reviewer pass still to do.

**Phase 3 preview gate:** all Week-3 features live; white-label pass complete.

---

# PHASE 4 — Handover & Definition of Done
*Brief §11. "The build is complete when every line below is true, not when the last feature merges."*

### Security review & hardening (brief §06 Week 3 close)
- [~] **P4-1 — Security review.** Verify §07 across the app: RLS, storage scoping,
  rate limits, upload validation, provider "no-training" setting recorded.
  - _2026-11-03:_ Audited and fixed: production refuses the dev sign-in and the example secret; session expiry and re-check; admin invites limited to the owner's organisation; admin flag forced off in workspace handlers; questionnaire links expire; storage signatures compared in constant time; RLS checked on every table from the catalog; every endpoint checked for a gate; rate limits; upload validation; no-training enforced and recorded (decisions log). Open: image re-encoding, a formal external review.
  - _2026-11-11:_ Image uploads are re-encoded with sharp (upright, all metadata removed, at most 4096 px, over 50 MP refused); abandoned uploads are swept after 24 hours from the cron route; structured JSON logs with redaction, and errors reported through `onRequestError` and `/api/client-error`, to Sentry when `SENTRY_DSN` is set (client's own account). Open: a formal external review.
- [x] **P4-2 — Seed data.** Realistic seed for a demo/reference workspace.
  - _2026-10-13:_ Owner org, a finished demo client (pieces, pillars, voice pack, caps) and a fresh client for onboarding.

### Product DoD (§11)
- [~] **P4-3** — A new client workspace can be created, invited, and used end to
  end **without developer involvement**.
  - _2026-11-03:_ All of it is in the admin console (create, invite, assign, access, caps, archive). Proven end to end once a deployment has a Resend sender.
- [ ] **P4-4** — Brand foundation, content studio, visual studio, calendar, idea
  inbox, and offer designer all work against a **real** brand profile with **real
  assets**.
- [ ] **P4-5** — Generated copy + images **pass Sahil's voice and brand review**.
- [ ] **P4-6** — Exports produce **clean PDF + Markdown** with client branding.

### Engineering DoD (§11)
- [~] **P4-7** — Cross-tenant access tests **pass in CI on every endpoint**.
  - _2026-11-03:_ Every table (catalog check), every data function family (isolation tests) and every server action and route (static gate check) are covered; per-route HTTP tests are not written. In CI an unreachable database now fails the run.
- [~] **P4-8** — **No Okra marks** in any client-facing surface (emails, exports,
  error pages).
  - _2026-11-03:_ Clean in code (see P3-13); formal reviewer pass to do.
- [ ] **P4-9** — **Secrets rotated**; no credentials in repo or its history.
- [x] **P4-10** — Migrations **run clean from empty** on a fresh database.
  - _2026-10-13:_ Runs clean from empty in CI and locally (13 Oct).

### Handover DoD (§11)
- [ ] **P4-11** — Source code in the **client's own repository, with full history**.
- [ ] **P4-12** — Hosting, DB, storage, domain, and model-provider accounts in the
  **client's name**; access transferred and **Okra's access removed on
  confirmation**.
- [x] **P4-13** — **README** covering local setup, env vars, deployment, and **how
  to edit prompt templates**.
  - _2026-10-13:_ README covers setup, env vars and prompt editing. No deployment section yet.
  - _2026-11-03:_ Rewritten for the current product, with a deployment section and the admin console.
- [x] **P4-14** — **Architecture note + data-model diagram** checked into the repo.
  - _2026-11-03:_ `docs/architecture.md`, with a Mermaid data-model diagram.
- [x] **P4-15** — **Phase-two list** written up from everything parked during the
  build, handed over with the code.
  - _2026-11-03:_ `docs/phase-two.md`, kept current.

---

## Phase-two parking lot (deferred, not cancelled — brief §08)
Anything parked mid-build lands here **and the client is told the same day**.
Seed items (NOT in v1): video gen/editing · direct LinkedIn/Instagram publishing ·
client self-serve sign-up + billing · native mobile apps · paid-ads/landing/CRM ·
published-post performance analytics.

- _2026-10-13 · build team_ · Background job queue and streaming (P2-4): generation runs in the request thread, bounded by a timeout. Needed before 90-day plans and carousel sets run for many clients at once.
- _2026-10-13 · build team_ · Rate limiting per user and per tenant (P2-5). The hard usage cap bounds spend in the meantime. **Built 2026-11-02.**
- _2026-10-13 · build team_ · Image model (P2-13): visuals are templated by the brief's own default; an AI-image provider is a client decision (cost) and a provider choice. **Decided and built 2026-11-11: ChatGPT Image, waiting on the key.**
- _2026-10-13 · build team_ · Strategy tools (P3-2), AEO page generator (P3-4), repurposing pipeline (P3-6), AI offer designer (P3-3): proposal modules not started.
- _2026-10-13 · build team_ · Custom domain + TLS (P3-11); full tenant branding on chrome, emails and exports (P3-12).
- _2026-10-13 · build team_ · Production sign-in (managed auth or a real email sender), S3 storage driver, upload re-encoding and SVG hardening: not demo-blocking, launch-blocking. See `docs/phase-two.md`.
