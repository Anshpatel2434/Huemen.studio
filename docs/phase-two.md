# Phase-two parking lot

Deferred, not cancelled (brief §08). Anything parked mid-build lands here **and
the client is told the same day** — never silently absorbed. Handed over with the
code at the end (DoD §11).

## Out of v1 by decision (brief §08)
- Video generation / editing
- Direct publishing to LinkedIn / Instagram APIs (export + copy-out only in v1)
- Client self-serve sign-up + subscription billing (accounts are admin-provisioned)
- Native mobile apps (responsive web only)
- Paid-ads creative, landing pages, CRM
- Analytics on published-post performance (usage analytics only in v1)

## Parked during the build
_(date · who raised it · one line · in-scope-or-two)_

Recorded on 2026-10-13 from a code audit of `voice-pack-v2` against the brief,
the proposal and TASKS.md. **The client has not yet been told about the items
marked "proposal module"; raise them before or alongside the key request.**

### Launch blockers (in scope, not yet built)
- 2026-10-13 · build team · **Production sign-in.** Only the dev cookie driver exists; `AUTH_DRIVER=managed` is accepted and not implemented, and the verify route throws outside dev. Needs a managed provider or a real email sender for the one-time links. In scope.
- 2026-10-13 · build team · **Email sending.** `sendAuthMail` sends nothing outside dev; invites are copied as links. In scope (Resend or similar).
- 2026-10-13 · build team · **S3 storage driver.** `STORAGE_DRIVER=s3` throws; local disk only. In scope.
- 2026-10-13 · build team · **Upload hardening.** MIME type trusted from the browser, no re-encoding, SVG logos served raw. In scope (P4-1).
- 2026-10-13 · build team · **Rate limiting** per user and per tenant (P2-5). In scope. The monthly hard cap bounds spend meanwhile.

### Promised, not started (proposal modules)
- 2026-10-13 · build team · **Image model** (P2-13): visuals are templated per the brief's own default; an AI image provider is a cost decision for the client and a provider choice for us. Decision pending.
- 2026-10-13 · build team · **Strategy tools** (P3-2): niche validation, 3x3 positioning matrix, authority ladder, Q1 to Q4 plan. Not started.
- 2026-10-13 · build team · **AI offer designer** (P3-3): today a manual form; offers do reach prompts as context. Not started.
- 2026-10-13 · build team · **Answer-first (AEO) page generator** (P3-4). Not started.
- 2026-10-13 · build team · **Repurposing pipeline** (P3-6). Not started.
- 2026-10-13 · build team · **Custom domain + TLS** (P3-11) and **full tenant branding** on chrome, emails and exports (P3-12): only the accent colour is applied today. Not started.

### Architecture debt (in scope, not demo-visible)
- 2026-10-13 · build team · **Job queue and streaming** (P2-4): the `jobs` table and `QUEUE_DRIVER` exist unused; everything runs in the request thread. Needed before batch work runs for many clients at once.
- 2026-10-13 · build team · **Failed draft as a retryable state** (P2-3): a failure is a toast; the request is not saved before the model call.
- 2026-10-13 · build team · **Cross-tenant tests over HTTP routes and server actions**: today they cover tables and data functions; `resolveScope` and the storage route are untested.
- 2026-10-13 · build team · **Context builder bypasses** (INV-2): six modules append brand or voice data to the task input outside `buildBrandContext`. Works, but it is the drift path the invariant forbids.
- 2026-10-13 · build team · **Observability**: no error tracking, no structured logger, no health endpoint.
- 2026-10-13 · build team · **Background sync for connections** (docs/integrations.md), Microsoft 365.
