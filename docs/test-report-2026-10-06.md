# Test pass, 6 October 2026 (internal)

Run against `main` at ef0f3f7 plus the fixes listed below, which are uncommitted. Local Postgres 18 with all 14 migrations applied; AI on the stand-in (`AI_TEXT_PROVIDER=mock`).

## Results

- `tsc --noEmit` is clean.
- **220/220 tests pass** with the database up. This matters: the database suites pass silently when Postgres is down.
- **Browser, as a brand-new client.** I added `fresh@client.test` / "Fresh Client" to the local database, since the seed skips when data already exists. The whole flow worked:
  - Sign-in sends a new client to onboarding, not the dashboard.
  - About you, then pasting 5 LinkedIn posts and 1 transcript: 6 pieces, 335 words measured.
  - Live preview, pre-filled answers with reasons, "this or that" (dials set from 4 picks), 12 words picked.
  - Hue step: pillars generated.
  - First draft written and checked; "Open my studio" lands on the dashboard.
- **Route smoke test.** 23 workspace, project and settings pages all return 200 with no error text. No server errors in the log and no console errors.
- **Brief and proposal coverage.** A background audit read the brief, the proposal and the design system against the code. Its findings are below. I spot-checked the biggest ones in the code myself.

## Fixed in this pass (uncommitted)

| Bug | Fix |
|---|---|
| Pieces written by onboarding, by "Draft from pillars" and by the agent panel showed **Not checked** on the dashboard, even though onboarding showed a score | These paths now score the piece after writing, the same way the content screen does. Verified: pillar drafts now show "90 On brand". |
| "1 piece reads differently… Did you write **them**… **they'll** stop…" | Singular copy for one piece |
| Quotes cut mid-word ("Would I sti", "sixty thous") | New `clip()` cuts at a word boundary and adds an ellipsis. Used for these quotes and for project names. Covered by `tests/clip.test.ts`. |
| Step 2 said "nothing is read from an account" right above "Connect accounts in Settings" | The copy now says accounts are read only if connected |

## Seen, not fixed

These are minor or belong to the stand-in.

- **Stand-in quirks that disappear with Claude:**
  - The voice preview capitalises the niche mid-sentence ("getting better at Personal finance…") and leaves a lowercase word after a full stop.
  - The "this or that" pairs are fixed leadership examples, not the client's niche.
  - The pillar names are generic.
- **"How you open" / "Here's how you usually start and end"** shows whole posts when a post is a single paragraph, instead of just the opening line.
- **Voice mirror** shows an empty "Your four words" and "Never" when those steps were skipped. It should say "not set yet".

## What the brief and proposal promise that isn't there

These came from the audit. The ones marked **(verified)** I confirmed in the code.

**Launch blockers: keys alone won't fix these.**
1. **Production sign-in and invites (verified).**
   - `sendAuthMail` sends nothing outside dev; it just returns `delivered: true`.
   - Login, invite and verify all call `devSignIn`, which throws when `AUTH_DRIVER` isn't `dev`.
   - Needs: an email sender (or a managed auth provider), plus a decision on production sessions.
2. **File storage (verified).** `STORAGE_DRIVER=s3` throws "S3 driver not wired yet". The local disk driver won't survive serverless hosting.
3. **Images.** Handover truth #1 is "a LinkedIn post **and its image**". Today visuals are on-screen HTML templates: no PNG is rendered, nothing is stored or downloadable, and no image model exists. Meanwhile proposal p6 tells Sahil he'll pay "image generation API costs".

**Proposal modules not built.**
- The 90-day calendar generator. The button is disabled (verified).
- The strategy tools: niche validation, 3x3 positioning matrix, authority ladder, Q1–Q4 plan.
- The AEO page generator.
- The repurposing pipeline.
- An AI offer designer. The current one is a manual form.
- Custom domain.
- The announcement graphic.

**Non-functional gaps.**
- No job queue or streaming. Generation runs inside the request, with a 120 s timeout.
- No rate limits.
- Usage caps are shown but nothing stops generation when one is hit.
- No admin screen for prompt templates.
- Upload types are trusted from the browser, and SVG logos are served back as-is, which is a script risk.
- Cross-tenant tests cover one table and no HTTP routes.

**Scope and process.**
- Voice Pack, onboarding and connections were built beyond the brief.
- `docs/phase-two.md` lists no parked items, although the brief says the client must be told the same day.
- TASKS.md, HANDOVER.md and README are out of date.

## Before sending the client note

`docs/client/ai-and-accounts-setup.md` asks for the accounts and keys and gives costs. It mentions only the three infrastructure items above (sign-in emails, storage, image download) as "last launch items on our side". It does **not** mention the missing proposal modules. Whether and how to raise those with Sahil is your call; I'd raise them before or alongside the key request, not after.
