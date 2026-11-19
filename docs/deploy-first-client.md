# The first client deploy (2026-11-19)

Live at **https://huemen-studio.vercel.app**.

| What | Where |
|---|---|
| App | Vercel project `huemen-studio` in the **Ghadtar** team (the account the CLI on Yash's PC is signed in to). Functions run in Dublin (`dub1`, set in `vercel.json`). Deployed from the PC with `vercel deploy --prod`; the project is not connected to GitHub. |
| Database | Supabase project `chpacvnuwrxmbvshicfs`, Ireland (eu-west-1). Migrations 0001 to 0028 applied, then `db:seed`. The app connects as `huemen_app` through the transaction pooler (port 6543). |
| Code | Branch `deploy-vercel` (on top of main at f8a4a6e). Local only until someone says push. |
| Settings | 36 values in Vercel > Project Settings > Environment Variables. The same values are in `.env.vercel` on Yash's PC (git-ignored). |
| Sign-in details | `.env.client-logins` on Yash's PC (git-ignored): three accounts, one line each. |

## What is different from the planned production setup, and why

Only a database string was available on the day: no email service and no file
bucket. Two stopgaps cover that. Both are switched by settings, so moving to
the planned setup later is a settings change, not a rebuild.

1. **Sign-in with a password** (`AUTH_PASSWORD_SIGNIN=true`, `MAIL_PROVIDER=log`,
   migration 0028). The emailed-link form is hidden, because no email can be
   sent. Still invite-only.
   - Add a person: Settings > Workspaces > invite them, **copy their invite
     link** from that page and send it to them yourself. They choose their own
     password when they accept.
   - Reset a password: `DOTENV_CONFIG_PATH=.env.vercel npx tsx scripts/set-password.ts <email>`.
     It prints a new password once.
   - To move to emailed links: set up Resend with a verified domain, then set
     `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`. Passwords can stay
     on beside the links, or be switched off with `AUTH_PASSWORD_SIGNIN=false`.
2. **Files kept in the database** (`STORAGE_DRIVER=pg`, migration 0027, table
   `storage_objects` with the same row-level security as every table). Each
   picture is about 1 MB and the free Supabase database holds 500 MB, so this
   is good for a few hundred pictures. Uploads over 4 MB are refused.
   - To move to a bucket: create a private bucket and S3 keys in Supabase
     Storage, set `STORAGE_DRIVER=s3` and the `STORAGE_S3_*` values
     (`deploy/vercel-production.env`), and copy the rows of `storage_objects`
     into the bucket under the same keys.

Also on Vercel: **Remove background is off** (`AI_CUTOUT_PROVIDER=off`). Its
runtime is 294 MB and a Vercel function may be 250 MB. The tool shows disabled
with its reason; every other picture tool works. Background jobs run after the
request that starts them and once a day through `/api/cron`.

## Checked on the live site (2026-11-19)

- `/api/health` answers `{"ok":true}`.
- Signed in as the demo client; the dashboard, Content and Visual pages load.
- The assistant answered "What should I write next?" in 2.6 s (Groq), using the demo brand's pillars.
- "Generate visuals" made two sets; "Add a picture" drew one through Runpod, saved it (1,084,153 bytes) and the page loads it.
- The storage tests (`tests/storage-pg.test.ts`) pass against this database, including that one workspace cannot read or write another's files.
- The password form was tested on the local copy (wrong password refused, right one signs in), not typed into the live site.

## Still to do

- **New keys.** The Groq and Runpod keys now on Vercel are the ones from Yash's PC, and both were pasted in chat earlier, as was the database password. Rotate all three, then update them in Vercel and redeploy.
- **Groq plan.** The free tier (about 8k tokens a minute, a daily cap, shared with another app) will stop a real client mid-session. Move to a paid plan.
- **The owner's real email.** The owner account is `admin@huemen.studio`, a placeholder. Invite Sahil's real address from Settings > Workspaces.
- **Push.** `deploy-vercel` is not on GitHub yet.
- **Migration numbers.** The parked branch `wip-2026-11-19` has its own `0027_generation_cost`; renumber it to 0029 before it merges.
