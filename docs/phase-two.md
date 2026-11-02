# Phase-two parking lot

Deferred, not cancelled (brief §08). Anything parked mid-build lands here **and
the client is told the same day** — never silently absorbed. Handed over with the
code at the end (DoD §11).

**Status as of 2026-11-02** (branch `dryrun-fixes`), checked against the code.
Items keep the date they were first raised; fixed ones say so. Hosting steps for
a first deploy are in `HANDOVER-TEST-DEPLOY-Vercel-Supabase-Groq.md`.

## Out of v1 by decision (brief §08)
- Video generation / editing
- Direct publishing to LinkedIn / Instagram APIs (export + copy-out only in v1)
- Client self-serve sign-up + subscription billing (accounts are admin-provisioned)
- Native mobile apps (responsive web only)
- Paid-ads creative, landing pages, CRM
- Analytics on published-post performance (usage analytics only in v1)

## Built, waiting on a key or a third party (no code needed)
- 2026-11-02 · build team · **All AI generation runs on the stand-in until a model key is set.** Drafts, rewrites, Check findings, pillars, topic suggestions, onboarding pre-fill, this-or-that pairs, the voice preview, the 90-day plan, the agent's card answers and the website read are all wired to Claude (`AI_TEXT_PROVIDER=anthropic`). Locally the suggestion cards say "Stand-in suggestion from your ... pillar". **Not yet tested with a real model; the first real run should check answer quality and how often the agent's card answers fail to lay out (`agent_answer_invalid` in the logs).**
- 2026-11-02 · build team · **Voice notes**: transcription is off until an OpenAI key is set. Typing works without it.
- 2026-11-02 · build team · **Google sign-in, Gmail, Docs and Calendar import** need the client's Google Cloud project. Gmail reading is limited to 100 invited testers until Google's security assessment.
- 2026-11-02 · build team · **Reading LinkedIn posts** waits on LinkedIn partner approval (`LINKEDIN_POSTS_APPROVED`). The LinkedIn data-export upload works today.
- 2026-11-02 · build team · **Brand font**: the app uses Archivo and Instrument Serif as stand-ins for Borna until the client confirms the licence covers web and server use.

## Launch blockers (in scope, not yet built)
- 2026-10-13 · build team · **Production sign-in.** Only the dev sign-in works: the login page offers one-click sign-in as any seeded account, and the verify route uses it. `AUTH_DRIVER=managed` is accepted but sign-in fails under it. Needs the one-time-link sign-in finished with a real email sender. In scope. **Still open.**
- 2026-10-13 · build team · **Email sending.** `sendAuthMail` sends nothing outside dev; invites are copied as links. In scope (Resend or similar). **Still open.**
- 2026-10-13 · build team · **S3 storage driver.** `STORAGE_DRIVER=s3` throws "not wired yet"; local disk only, which hosted servers do not keep. In scope. **Still open.**
- 2026-10-13 · build team · **Upload hardening.** File type trusted from the browser, no re-encoding, SVG logos served raw. In scope (P4-1). **Still open.**
- 2026-10-13 · build team · **Rate limiting** per user and per tenant (P2-5). In scope. The monthly hard cap bounds spend meanwhile. **Still open.**
- 2026-11-02 · build team · **Hosting fixes for Vercel and Supabase**: the migration's role step uses superuser-only options Supabase may refuse on a re-run; uploads up to 10 MB go through a server request Vercel caps at 4.5 MB; the database pool (10 per instance) needs lowering for many serverless instances. In scope. Not started.

## Promised, not started (proposal modules)
**Confirm these have been raised with the client.** On 2026-10-13 they had not been.
- 2026-10-13 · build team · **Image model** (P2-13): visuals are templated per the brief's own default; the image entry point exists but returns a placeholder and nothing calls it. An AI image provider is a cost decision for the client and a provider choice for us (options and costs in the launch plan). Decision pending.
- 2026-10-14 · design system v1.0 · **Strategy tools** (P3-2): niche validation, 3x3 positioning matrix, authority ladder. **Won't build.** The design system makes positioning an explicit non-goal: the product holds a voice and checks against it, it does not decide what anyone stands for, and a positioning wizard or "find your niche" step promises what software cannot deliver. Where positioning needs work, the product says so and points at human help (the workshop). The Q1 to Q4 plan is a calendar question and stays open.
- 2026-10-13 · build team · **AI offer designer** (P3-3): today a manual form; offers do reach prompts as context. Not started.
- 2026-10-13 · build team · **Answer-first (AEO) page generator** (P3-4). Not started.
- 2026-10-13 · build team · **Repurposing pipeline** (P3-6). Not started.
- 2026-10-13 · build team · **Custom domain + TLS** (P3-11) and **full tenant branding** on chrome, emails and exports (P3-12): only the accent colour is applied today. Not started.

## Interface debt (in scope)
- 2026-11-01 · build team · **Clutter.** A measured review of nine screens found seven patterns that make the studio feel heavy (always-on chrome, competing primary buttons, instruction paragraphs, the same fact in up to ten places, panels crowding the canvas, too many label styles, empty states first). The review, the clean-UI rules and a five-phase plan (about 3.5 days) were shared as a report; the owner chose to review it with the client before any code changes. Not started.
- 2026-11-01 · build team · **Native dropdowns.** 17 browser `<select>`s remain, against the no-system-UI rule; one shared Huemen dropdown replaces them all. Part of the clutter plan. Not started.

## Architecture debt (in scope, not demo-visible)
- 2026-10-13 · build team · **Job queue and streaming** (P2-4): the `jobs` table and `QUEUE_DRIVER` exist unused; everything runs in the request thread. Needed before batch work runs for many clients at once. **Still open.**
- 2026-10-13 · build team · **Failed draft as a retryable state** (P2-3): **partly fixed.** A live draft (the Content step's Draft and the agent's Draft buttons) that fails keeps its topic and format and offers Try again. Other generations still show a toast, and the request is not saved before the model call.
- 2026-10-13 · build team · **Cross-tenant tests over HTTP routes and server actions**: today they cover tables and data functions; `resolveScope` and the storage route are untested. **Still open.**
- 2026-10-14 · build team · **Context builder bypasses** (INV-2): **fixed.** Pillars (with descriptions) and strategy answers now ride in the context block; never-words were removed from the check, rewrite-part and preview inputs (the stand-in reads them from the context, as the real model does); calendar and topic inputs name pillars only. `tests/context-invariant.test.ts` fails the build if a data module writes brand data into a task input again. The live-preview stand-in still reads a few measured hints (dials, sentence length) from its input; they duplicate the block and are the next to go.
- 2026-10-13 · build team · **Observability**: no error tracking, no structured logger, no health endpoint. **Still open.**
- 2026-10-13 · build team · **Background sync for connections** (docs/integrations.md), Microsoft 365. **Still open.**

## Done since the 2026-10-13 audit
- 2026-11-02 · **Website reader**: real crawl of the home and About pages; correct brand colours on modern and dark sites; a model read of what they do pre-fills onboarding (`8a6b15a`).
- 2026-11-01 · **Agent drafts write live on the canvas**, beside the conversation (`13da971`).
- 2026-10-30 · **Agent answers as cards** (OpenUI): plans, ideas, hooks and brief checks with working buttons (`0227914`).
- 2026-10-31 · **Pre-API dry-run fixes**: hydration error, edits lost to "regenerate with a steer", onboarding words unused, scoring that did not separate on-brand from off-brand, a 90-day plan that repeated itself (`d88d68f`).
- 2026-10-29 · **Short onboarding** (seven screens), Getting started guide, Relume-style pillar map and style guide (`595d7f8`).
