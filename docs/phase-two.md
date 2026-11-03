# Phase-two parking lot

Deferred, not cancelled (brief §08). Anything parked mid-build lands here **and
the client is told the same day** — never silently absorbed. Handed over with the
code at the end (DoD §11).

**Status as of 2026-11-02** (branch `launch-blockers`), checked against the code.
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

## Launch blockers
All six fixed on 2026-11-02 (branch `launch-blockers`); see "Done" below. What
is left around them:
- 2026-11-02 · build team · **Owner steps before launch (no code):** a Resend account with a verified sending domain (`MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`); a private bucket in the client's own account with keys and a CORS rule allowing PUT from the app's address; `DATABASE_POOL_MAX` set to 1 to 3 on Vercel. All in `.env.example`.
- 2026-11-02 · build team · **Image re-encoding** (rest of P4-1): uploads are checked by their real type and SVGs with active content are refused, but images are stored as uploaded (metadata kept). Re-encoding needs an image library (sharp). Not started.
- 2026-11-02 · build team · **Abandoned uploads**: a file sent to storage and never used stays under the workspace's `incoming/` prefix. Small (size-limited per upload), but nothing sweeps it yet. Not started.

## Promised, not started (proposal modules)
**Confirm these have been raised with the client.** On 2026-10-13 they had not been.
- 2026-10-13 · build team · **Image model** (P2-13): visuals are templated per the brief's own default; the image entry point exists but returns a placeholder and nothing calls it. An AI image provider is a cost decision for the client and a provider choice for us (options and costs in the launch plan). Decision pending.
- 2026-10-14 · design system v1.0 · **Strategy tools** (P3-2): niche validation, 3x3 positioning matrix, authority ladder. **Won't build.** The design system makes positioning an explicit non-goal: the product holds a voice and checks against it, it does not decide what anyone stands for, and a positioning wizard or "find your niche" step promises what software cannot deliver. Where positioning needs work, the product says so and points at human help (the workshop). The Q1 to Q4 plan is a calendar question and stays open.
- 2026-10-13 · build team · **AI offer designer** (P3-3): today a manual form; offers do reach prompts as context. Not started.
- 2026-10-13 · build team · **Answer-first (AEO) page generator** (P3-4). Not started.
- 2026-10-13 · build team · **Repurposing pipeline** (P3-6). Not started.
- 2026-10-13 · build team · **Custom domain + TLS** (P3-11) and **full tenant branding** on chrome, emails and exports (P3-12): the accent colour is applied to the chrome and the PDF export and is settable per workspace since 2026-11-03; a tenant LOGO and tenant fonts are applied nowhere, and emails carry no tenant branding at all. Partly done.

## Interface debt (in scope)
- 2026-11-01 · build team · **Clutter.** A measured review of nine screens found seven patterns that make the studio feel heavy (always-on chrome, competing primary buttons, instruction paragraphs, the same fact in up to ten places, panels crowding the canvas, too many label styles, empty states first). The review, the clean-UI rules and a five-phase plan (about 3.5 days) were shared as a report; the owner chose to review it with the client before any code changes. Not started.
- 2026-11-01 · build team · **Native dropdowns.** 16 browser `<select>`s remain (the brief editor's asset type became chips on 2026-11-02), against the no-system-UI rule; one shared Huemen dropdown replaces them all. Part of the clutter plan. Not started.

## Architecture debt (in scope, not demo-visible)
- 2026-10-13 · build team · **Job queue and streaming** (P2-4): the `jobs` table and `QUEUE_DRIVER` exist unused; everything runs in the request thread. Needed before batch work runs for many clients at once. **Still open.**
- 2026-10-13 · build team · **Failed draft as a retryable state** (P2-3): **partly fixed.** A live draft (the Content step's Draft and the agent's Draft buttons) that fails keeps its topic and format and offers Try again. Other generations still show a toast, and the request is not saved before the model call.
- 2026-10-13 · build team · **Cross-tenant tests over HTTP routes and server actions**: today they cover tables and data functions; `resolveScope` and the storage route are untested. **Still open.**
- 2026-10-14 · build team · **Context builder bypasses** (INV-2): **fixed.** Pillars (with descriptions) and strategy answers now ride in the context block; never-words were removed from the check, rewrite-part and preview inputs (the stand-in reads them from the context, as the real model does); calendar and topic inputs name pillars only. `tests/context-invariant.test.ts` fails the build if a data module writes brand data into a task input again. The live-preview stand-in still reads a few measured hints (dials, sentence length) from its input; they duplicate the block and are the next to go.
- 2026-10-13 · build team · **Background sync for connections** (docs/integrations.md), Microsoft 365. **Still open.**

## Done since the 2026-10-13 audit
- 2026-11-03 · **Announcement graphic and keepable variants** (§4.3): the brief
  asks for four output types and the announcement one was never built, so a
  piece had no graphic for "I'm speaking at X". It is the fourth artboard now,
  in three layouts. Regenerating also used to DELETE the previous set, so
  trying a second colour scheme destroyed the first with no way back — which
  makes the control hostile to use, since comparing is the whole point. Sets
  are kept and marked instead, and "Earlier sets" restores one reversibly.
- 2026-11-03 · **Settable white-label accent** (part of P3-12): the chrome had
  always read `tenants.branding.accent`, but nothing could write it outside the
  seed, so every real workspace ran on the house vermilion. Admins set it per
  workspace now, audited, and the brand brief PDF uses it.
- 2026-11-03 · **Context version on every call** (INV-2): `generation_logs`
  carries `context_version`. The context builder's docstring had claimed this
  was recorded since long before anything wrote it, so tracing a bad output
  back to the context shape that produced it was not actually possible.
- 2026-11-03 · **Observability** (was: no error tracking, no structured logger, no health endpoint): `src/lib/log.ts` emits one JSON line per event in production and stays readable in development, with `LOG_LEVEL` as the floor; every ad-hoc `console.error` now goes through it with an event name. `reportError` POSTs to `ERROR_WEBHOOK_URL` when the deployment sets one — a seam rather than a vendor, because choosing the error tracker is the client's call. `GET /api/health` answers 200 or 503 within five seconds, bounded so a wedged database is reported rather than hung on.
- 2026-11-02 · **Production sign-in and email**: one-time sign-in links and invites sent through Resend; `AUTH_DRIVER=email` refuses to start without a sender (`6a261e9`).
- 2026-11-02 · **S3 storage driver** for AWS S3, Supabase Storage or Cloudflare R2, in the client's own account (`8b3f4f1`).
- 2026-11-02 · **Upload safety**: the type is read from the file's bytes, SVGs with active content are refused, stored files are served with nosniff, a sandboxing CSP and download-unless-image (`f990da2`).
- 2026-11-02 · **Rate limits**: 20 model calls a minute per person and 60 per workspace (settings), five sign-in emails per account per 15 minutes; counted in Postgres so they hold across serverless instances (`13e75c6`).
- 2026-11-02 · **Hosting fixes**: migrations run on managed Postgres without superuser and refuse to finish if the app role could bypass row-level security; pool size is a setting (`6244d98`).
- 2026-11-02 · **Direct uploads**: files go from the browser to storage and the server reads them back, so the 1 MB server-action limit (which broke assets over 1 MB) and Vercel's 4.5 MB limit no longer apply (`5d8614a`).
- 2026-11-02 · **Website reader**: real crawl of the home and About pages; correct brand colours on modern and dark sites; a model read of what they do pre-fills onboarding (`8a6b15a`).
- 2026-11-01 · **Agent drafts write live on the canvas**, beside the conversation (`13da971`).
- 2026-10-30 · **Agent answers as cards** (OpenUI): plans, ideas, hooks and brief checks with working buttons (`0227914`).
- 2026-10-31 · **Pre-API dry-run fixes**: hydration error, edits lost to "regenerate with a steer", onboarding words unused, scoring that did not separate on-brand from off-brand, a 90-day plan that repeated itself (`d88d68f`).
- 2026-10-29 · **Short onboarding** (seven screens), Getting started guide, Relume-style pillar map and style guide (`595d7f8`).
