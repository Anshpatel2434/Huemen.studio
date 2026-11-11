# Handover: test deploy on Vercel + Supabase, with Groq as the AI

**Goal:** put Huemen.studio on a temporary Vercel + Supabase setup and walk the
whole flow end to end, with Groq's free API standing in for Claude. This is a
**flow test, not the launch**: demo data only, a protected URL, throwaway
accounts.

**Branch to deploy:** `audit-fixes` (or `main` once its pull request is merged).
It includes everything: the short onboarding, Getting started, the
Relume-style brand core, the agent's card answers (OpenUI), the launch-blocker
fixes (sign-in email, S3 storage, upload safety, rate limits, hosting fixes,
direct uploads) and the 3 November audit fixes (security, admin console,
product connections).

**State on 3 November 2026:** everything works locally on Docker Postgres with
the built-in stand-in writer (`AI_TEXT_PROVIDER=mock`). Typecheck and lint are
clean, and all 415 tests pass. The migration step was also run against a
Postgres where the migrating user is not a superuser, as on Supabase. Nothing
has been deployed yet, and no real model has been connected yet.

Read this whole file before starting. Section 1 says what is still missing and
what was fixed, because a few steps depend on it.

---

## 1. What is missing, and what was fixed

Still missing (a workaround is given for the test):

| # | Gap | Where | Test workaround |
|---|---|---|---|
| B1 | **No AI provider for Groq.** Only `mock` and `anthropic` exist. `AI_TEXT_PROVIDER=openai` is in the settings list but throws "not built". | `src/lib/ai/index.ts` (`selectTextProvider`), `src/lib/env.ts` | Build a small Groq provider (section 4). Do the first deploy on `mock`. |
| B7 | **No AI images.** Visuals are rendered from templates. The image entry point returns a 1x1 placeholder and nothing calls it. | `src/lib/ai/index.ts` (`generateImage`) | None needed. Visuals still work from templates. |

Fixed on 2 November (the old workarounds are no longer needed):

| # | Was | Now |
|---|---|---|
| B2 | Sign-in emails were never sent. | `AUTH_DRIVER=email` with `MAIL_PROVIDER=resend` sends one-time sign-in links and invites. It refuses to start without `RESEND_API_KEY` and `MAIL_FROM`. With no Resend account, use `AUTH_DRIVER=dev` **and** `AUTH_ALLOW_DEV_SIGNIN=true` behind Deployment Protection: a production server refuses the dev sign-in without that second setting, because it lets anyone sign in as anyone. |
| B3 | No S3 storage driver. | `STORAGE_DRIVER=s3` works with Supabase Storage, AWS S3 or R2. Use a private Supabase Storage bucket (section 2, step 7). |
| B4 | Migration role step might fail on a re-run on Supabase. | Fixed and tested as a non-superuser. Migrate also refuses to finish if `huemen_app` could bypass row-level security. |
| B5 | Uploads over 4.5 MB failed (and brand assets over 1 MB). | Files go from the browser straight to the bucket. Files over 4 MB need a CORS rule on the bucket (section 2, step 7); smaller ones work without it. |
| B6 | Pool size hard-coded at 10. | `DATABASE_POOL_MAX`; set `2` on Vercel. |
| new | No rate limits. | 20 model calls a minute per person, 60 per workspace (`AI_RATE_PER_USER_MINUTE`, `AI_RATE_PER_WORKSPACE_MINUTE`), five sign-in emails per account per 15 minutes. |

Not blockers, but untested: real-model output quality anywhere, especially the
agent's card answers (OpenUI Lang). Groq's models are not Claude, so treat
answer quality from this test as a floor, not the real thing.

---

## 2. Supabase (about 20 minutes)

1. **Create a project** in region **Mumbai (ap-south-1)**. Save the database password.
2. **Turn off the Data API** (Project Settings > Data API, or API > "Enable Data API" off).
   Huemen never uses it, and leaving it on publishes the tables over a public REST API.
3. **Get two connection strings** from the **Connect** button. Copy the host exactly from there; it is not always `aws-0`.
   - **Admin (migrations, from your laptop):** the **Session pooler**, port **5432**:
     `postgresql://postgres.<project-ref>:<db-password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
     (Do not use the direct `db.<ref>.supabase.co` host. It is IPv6-only and fails from most networks.)
   - **App (Vercel):** the **Transaction pooler**, port **6543**, but logged in as the app role, not `postgres`:
     `postgresql://huemen_app.<project-ref>:<app-password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`
     The user is `huemen_app.<project-ref>`, so the role name, a dot, then the project ref. That is how Supabase's pooler routes custom roles.
4. **Pick an app password** (long, random) for `huemen_app`. It goes in `DATABASE_APP_PASSWORD` and in the app connection string above.
5. **Run migrations and seed from your laptop,** pointing at Supabase. Put these in a temporary `.env.supabase` in the repo root. `.gitignore` already ignores `.env*`, so it cannot be committed by accident:
   ```
   DATABASE_ADMIN_URL=<admin session-pooler string>
   DATABASE_URL=<app transaction-pooler string>
   DATABASE_APP_PASSWORD=<app password>
   AUTH_SECRET=<any 32+ chars>
   ```
   The scripts load env through `dotenv/config`, which reads the file named in `DOTENV_CONFIG_PATH`:
   ```bash
   DOTENV_CONFIG_PATH=.env.supabase npm run db:migrate
   DOTENV_CONFIG_PATH=.env.supabase npm run db:seed
   ```
   On PowerShell, set `$env:DOTENV_CONFIG_PATH=".env.supabase"` first, then run the two npm scripts.
   Migrate creates the role and every table with row-level security. Seed creates the demo workspaces and accounts, such as `demo@client.test`. Migrate can be re-run safely; it stops with a plain message if `huemen_app` could skip row-level security.
   **Never run `npm run db:reset`**: it wipes the local Docker database, and it is not meant for Supabase.
6. **SSL:** if the app or migrate fails with a certificate error, add `?sslmode=no-verify` to the connection strings (test only).
7. **Storage bucket.** Storage > New bucket, name `huemen`, **private**. Then Project Settings > Storage > S3 Connection: enable it, note the endpoint (`https://<project-ref>.supabase.co/storage/v1/s3`) and region, and create an access key pair. These go in Vercel only (section 3). Supabase does not let you set CORS on a bucket through its S3 API; if uploads over 4 MB fail in the browser console with a CORS error, note it: smaller uploads still work through the app, and the real launch will use a bucket where CORS can be set (S3 or R2).

---

## 3. Vercel (about 20 minutes)

1. **Import** `Anshpatel2434/Huemen.studio` and set the branch `audit-fixes` (or `main` once merged) as the one to deploy (or deploy it as a preview).
2. **Function region:** Project Settings > Functions > **Mumbai (bom1)**, next to Supabase. Every query crosses this hop, so the wrong region makes every page slow.
3. **Deployment Protection:** turn it **on** (Standard Protection). Required if you use `AUTH_DRIVER=dev`, which lets anyone with the URL sign in as anyone.
   **Function time limit:** Project Settings > Functions > Max Duration, as high as the plan allows (300 s). Batches (a draft from every pillar, the 90-day plan) run in the job queue after the request that starts them, inside that limit (README, Background jobs).
4. **Environment variables** (Project Settings > Environment Variables). Set them all **before** the first build:

   | Name | Value |
   |---|---|
   | `APP_URL` | the Vercel URL, e.g. `https://huemen-test.vercel.app` |
   | `DATABASE_URL` | app transaction-pooler string (section 2.3) |
   | `DATABASE_ADMIN_URL` | admin session-pooler string (the app checks it is set; only migrations use it) |
   | `DATABASE_APP_PASSWORD` | the app password |
   | `AUTH_SECRET` | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `DATABASE_POOL_MAX` | `2` |
   | `AUTH_DRIVER` | `dev` plus `AUTH_ALLOW_DEV_SIGNIN=true` (test only, behind Deployment Protection), or `email` if you set up Resend (then also `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`) |
   | `STORAGE_DRIVER` | `s3` |
   | `STORAGE_S3_BUCKET` | `huemen` |
   | `STORAGE_S3_REGION` | the project's region, e.g. `ap-south-1` |
   | `STORAGE_S3_ENDPOINT` | `https://<project-ref>.supabase.co/storage/v1/s3` |
   | `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` | the key pair from section 2, step 7 |
   | `AI_TEXT_PROVIDER` | `mock` for the first deploy, then your Groq provider (section 4) |
   | `AI_TEXT_FALLBACKS` | `off` (the server-side fallback is an Anthropic feature) |
   | `AI_TRANSCRIBE_PROVIDER` | `off` |
   | `AI_IMAGE_PROVIDER` | `mock` for this test (stand-in pictures). For ChatGPT Image later: `openai` plus `OPENAI_API_KEY` and `AI_IMAGE_MODEL` (README, Pictures). |
   | `OPENUI_TELEMETRY_DISABLED` | `1` (OpenUI's install script sends anonymous telemetry unless this is set during the build) |
   | `CONNECTIONS_KEY` | optional; only for the Gmail/Google connections, which this test skips |
   | `CRON_SECRET` | optional for this test: 16+ random characters if you add a Cron Job on `/api/cron` (Vercel Pro allows every few minutes; Hobby only daily). Without it, queued jobs still run while their page is open. |

   Leave every `GOOGLE_*`, `LINKEDIN_*` and `ANTHROPIC_API_KEY` blank. Google sign-in and Gmail import need the Vercel URL added as a redirect URI in a Google Cloud project; skip them for this test.
5. **Deploy.** The build is plain `next build`; nothing else is needed. The lockfile already includes the `@emnapi/*` entries that Linux `npm ci` needs. If you ever run `npm install` on Windows and commit the lockfile, check those entries are still there.
6. **Health check:** open `/api/health` on the Vercel URL. `{"ok":true}` means the app reaches Supabase as `huemen_app`; a 503 means the connection string, password or pooler user is wrong.
7. **First check, on `mock`:** open the URL, sign in as `demo@client.test` (one click on the dev sign-in page), and click through. If this works, Vercel, Supabase, the region, the role and row-level security are all right. Only then switch the AI.

---

## 4. Groq as the AI (the code you need to add)

Groq is not wired in. Add it as a third text provider; it is about one file.

**Where:**
- New file `src/lib/ai/providers/groq.ts`, implementing `StreamingTextProvider` from `src/lib/ai/types.ts`. Copy the shape of `src/lib/ai/providers/anthropic.ts`. It needs three methods:
  - `generate(req, model)`: send `req.prompt.system` as the system message and `req.prompt.user` as the user message. Return `{ variants, model, tokensIn, tokensOut }`. Drafts ask for N versions; the Anthropic provider gets them as structured output `{ variants: string[] }`. Do the same with Groq's JSON output (`response_format`), then validate.
  - `structured(req, model, schema)`: the "tasks" (topic suggestions, voice check, rewrites, onboarding pre-fill and so on) need JSON matching a Zod schema. Ask Groq for JSON (`response_format` with `json_schema` on models that support it, else `json_object` plus the schema in the prompt), then `schema.parse()` the reply. A reply that fails validation must throw `ProviderError` (`src/lib/ai/errors.ts`), never return half a shape.
  - `stream(req, model)`: yield `{ type: "delta", text }` for each chunk, then one `{ type: "done", model, tokensIn, tokensOut }`. Used by live drafts and by the agent's card answers.
- `src/lib/env.ts`: add `"groq"` to the `AI_TEXT_PROVIDER` enum, and add `GROQ_API_KEY: z.string().optional()`.
- `src/lib/ai/index.ts`: add `case "groq":` in `selectTextProvider`, returning your provider.
- Use Groq's OpenAI-compatible endpoint `https://api.groq.com/openai/v1` (the `openai` npm package with `baseURL` works, or plain `fetch`).
- Ignore `cache_control`, effort and server-side fallbacks. Those are Anthropic features.

**Settings once built (Vercel env):**
```
AI_TEXT_PROVIDER=groq
GROQ_API_KEY=<from console.groq.com, paste in Vercel only>
AI_TEXT_MODEL_STRONG=<a large model from Groq's model list, e.g. openai/gpt-oss-120b>
AI_TEXT_MODEL_CHEAP=<a small fast one, e.g. llama-3.1-8b-instant>
AI_TEXT_EFFORT_STRONG=
AI_TEXT_EFFORT_CHEAP=
```
Check the exact model names on Groq's console first; their list changes. For
`structured`, pick a strong model that supports JSON schema output.

**Expect these with Groq's free tier:**
- **Rate limits.** Huemen's prompts are large: 3,600 to 7,000 tokens of brand context per call, and the agent adds about 1,500 tokens of component spec. Free-tier per-minute token limits are low, so 429 errors after a few quick actions are normal. Test as one person, at a human pace. (Huemen's own limit, 20 calls a minute per person, is far above what the free tier allows.) Errors show as a plain "try again" message and are logged in `generation_logs`.
- **Agent card answers.** The agent must reply in OpenUI Lang (spec in `src/lib/agent-ui/prompt.ts`). If a model writes it badly, the panel shows "I couldn't lay that answer out" and the server logs `agent_answer_invalid` with the error codes. Count those; it is the most useful number from this test.
- **Data.** Use demo data only. The brief's rule is that client data is never used for model training; that is agreed with Anthropic, not with Groq.

---

## 5. The flow to walk (tick as you go)

The seed creates three accounts, each one click on the dev sign-in page:
`fresh@client.test` (an empty workspace that starts at onboarding),
`demo@client.test` (a finished workspace with a brief, pillars and pieces), and
`admin@huemen.studio` (the platform admin).

- [ ] **Onboarding, 7 screens** (as `fresh@client.test`): website, name, audience, writing (paste a post), look (upload one image; then try one between 4 and 5 MB to see whether the bucket accepts the browser directly), words, first draft. The first draft is written by the model and scored.
- [ ] **Getting started guide** opens after the first draft. Open each tab: voice (this-or-that pairs), brand rules, stories and facts, pillars, more writing.
- [ ] **Brand core:** pillar map (add a pillar from the library), style guide (shuffle colours, light/dark preview).
- [ ] **A project:** Ideate (pick pillar and angle), then Content: draft one piece live (streams in), ask for a change on one line, approve it.
- [ ] **Check:** paste any text and get a voice score with findings.
- [ ] **Visual:** wireframe, then design with a scheme; download the set.
- [ ] **Agent panel** (wand icon in the project's left rail): ask "Plan my week", "What should I write next?", "Give me hooks for a post on pricing", "What's missing from my brief?". Press a **Draft** button on a card, then **Save to ideas** on a hook, then **Add pillar** on a suggested pillar.
- [ ] **Usage:** the workspace's Usage page (`/w/<id>/usage`) shows every call. In Supabase, `generation_logs` has one row per call.
- [ ] **Tenant isolation:** `fresh@client.test` and `demo@client.test` are different workspaces. Signed in as one, you must never see the other's brief, pillars, pieces or files, even by pasting the other workspace's URL (it must 404). This is the one bug class that cannot ship.

Write down every failure with the page, the time, and what Vercel's function logs say.

---

## 6. What this test does not prove (still needed for launch)

- Sign-in by email for real, unless you set up Resend: it needs the client's own sending domain.
- Uploads over 4 MB on a bucket with a CORS rule (S3 or R2 in the client's account).
- Image re-encoding on upload, and a sweep of abandoned uploads (both in `docs/phase-two.md`).
- Claude's quality and cost. Production is planned on Claude (Opus 5.5 for writing, Haiku 5.5 for light work), not Groq.
- Load capacity. Run a load test on staging once the above are done.

The full launch plan (hosting options, models, image generation, capacity) is
the "Huemen Launch Plan" page shared separately. Design notes for the agent's
card answers are in `docs/agent-answers.md`.

## 7. Rules for this repo

- Never commit `.env` or any key. Keys go in Vercel's settings, not in files or chat.
- Never run `npm run db:reset` against anything you care about; it wipes the database.
- Do not push to `main`. Work on a branch off `audit-fixes` (or `main` once merged).
- No emojis in UI copy or docs.
- `AGENTS.md` explains the two rules the whole codebase rests on: tenant isolation in the database, and one brand-context builder for every prompt. Read it before changing data access or prompts.
