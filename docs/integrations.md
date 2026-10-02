# Connections: setup guide

Huemen.studio can read a person's writing straight from **Gmail**, **Google Docs and Slides**, **Google Calendar** and **LinkedIn**, with their consent, to learn how they sound. Everything is built and tested. A provider switches on when its app credentials are in `.env`.

Code: `src/lib/integrations/*` (providers, OAuth, importers), `src/lib/data/connections.ts` (storage), `src/app/settings/connections` (the page, under **Settings › Connections**), `src/app/settings/connections/[provider]/start` and `src/app/connections/callback/[provider]` (the OAuth routes). Migration `0013_connections.sql`.

## What each connection reads

| Capability | Scope | Reads | Kept as | Google/LinkedIn review |
|---|---|---|---|---|
| Sent email | `gmail.readonly` | Sent mail, last 2 years, up to 200 per run. Body only: quotes, forwards and signatures stripped. Messages under 25 words are skipped. | **Private**: measured, never quoted | **Restricted**: verification plus annual security assessment (CASA) |
| Docs and Slides | `drive.file` + Google Picker | Only the files the person picks. Exported as plain text and capped at 3,000 words. | Public if they tick "Published", otherwise private | None |
| Calendar | `calendar.events.readonly` | Next 60 days: title, date, short description. **Never attendees.** | Chosen events become ideas, not writing | Sensitive: verification, no assessment |
| YouTube captions | `youtube.force-ssl` | Captions from up to 10 of the person's latest videos on their own channel: uploaded captions first, automatic ones otherwise. `captions.download` costs 200 quota units, so one run reads at most 10. | Public, spoken | Sensitive: verification. **Check this scope's current classification on Google's list before submitting.** |
| LinkedIn profile | `openid profile email` | Name, email, photo | Nothing stored except name and email | None |
| LinkedIn posts | `r_member_social` | The person's own posts (not reshares) | Public | **Partner programme approval** |

Each capability asks for its scopes only when the person switches it on. Connecting Google for Docs never asks to read mail.

## Rules the code enforces

- **A connection belongs to one person.** Every read is filtered to the signed-in user. A coach in a client's workspace can't connect, import or even see the client's connection, and only the voice's owner can start a connection.
- **Tokens are encrypted at rest** (AES-256-GCM, key in `CONNECTIONS_KEY`), never stored in the clear and never sent to the browser. The one exception is the Picker, which needs a short-lived access token in the person's own browser; that's Google's standard pattern.
- **OAuth state is signed** (HMAC with `AUTH_SECRET`), expires in 10 minutes, and is bound to a nonce in an httpOnly cookie. Google also uses PKCE. The callback checks the signed-in person is the one who started the connection.
- **No duplicates.** Each imported piece carries its provider id (`gmail:…`, `drive:…`, `linkedin:…`), unique per voice pack.
- **Disconnect** withdraws access at the provider, deletes the tokens, and, if the person chooses, removes everything that connection brought in, then re-measures.
- **Tenant-consistent.** A sample can only reference a connection in its own workspace (composite foreign key, tested).

## Links (no connection needed)

In onboarding step 1, people paste links to their own website, blog, Substack, Medium or podcast feed. The server reads posts from the feed it finds (Substack and Medium feeds are found automatically, other sites through the feed they advertise), or the article on a single page. A podcast feed is read through its **Podcasting 2.0 transcript links**; audio-only feeds are reported as such. The person confirms the links are their own writing first. Limits: 30 posts per link, 3,000 words each.

The server fetches what a person typed, so `src/lib/integrations/web.ts` guards it: http(s) only, ports 80 and 443 only, no logins in URLs. Every address a name resolves to is checked when the socket opens, so DNS rebinding can't sneak past an earlier check. Private, loopback, link-local and cloud-metadata ranges are refused. It allows at most 3 redirects (each re-checked), 2 MB and 10 seconds. Caption files (`.vtt`, `.srt`) can also be uploaded straight into the "Podcast, video or talk" source.

## Google: one-time setup

1. In [Google Cloud console](https://console.cloud.google.com), create a project (e.g. "Huemen Studio") owned by The Brand Professor's Google Workspace, not by Okra.
2. **APIs & Services → Library**: enable the **Gmail API**, **Google Drive API**, **Google Picker API**, **Google Calendar API** and **YouTube Data API v3**.
3. **OAuth consent screen**: External, app name and logo from the client's branding, support email, privacy policy URL, home page. Add these scopes: `openid`, `email`, `profile`, `gmail.readonly`, `drive.file`, `calendar.events.readonly`, `youtube.force-ssl`.
4. **Credentials → Create credentials → OAuth client ID → Web application.** Authorised redirect URIs:
   - `http://localhost:3120/connections/callback/google` (development)
   - `https://<production domain>/connections/callback/google`

   Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. **Credentials → Create credentials → API key.** Restrict it to the Picker API and to the app's domains (HTTP referrers). Put it in `GOOGLE_PICKER_API_KEY`. The project number (Dashboard → Project info) goes in `GOOGLE_PROJECT_NUMBER`.
6. Generate `CONNECTIONS_KEY` once and keep it safe. Losing it means everyone reconnects; leaking it means rotating it, which also means everyone reconnects.

**Before verification:** leave the app in **Testing** and add each person as a test user (up to 100). That's enough for a pilot with Sahil's clients. In Testing mode Google expires refresh tokens after 7 days, so people reconnect weekly. The page handles that and says "Reconnect".

**For public launch:** submit for verification. Docs alone needs none. Calendar needs standard verification. **Gmail needs restricted-scope verification plus a CASA assessment by a Google-approved lab, renewed yearly.** Budget weeks and a fee. If Gmail isn't wanted at launch, leave it off; the rest still works.

## LinkedIn: one-time setup

1. At [linkedin.com/developers](https://www.linkedin.com/developers/apps), create an app linked to The Brand Professor's LinkedIn Page.
2. **Products**: add **Sign In with LinkedIn using OpenID Connect**.
3. **Auth**: add redirect URLs `http://localhost:3120/connections/callback/linkedin` and the production one. Copy the client ID and secret into `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`.
4. **Posts:** reading a member's own posts (`r_member_social`) is limited to approved partners (Community Management API). Apply if wanted. Until it's granted, keep `LINKEDIN_POSTS_APPROVED=false`; people upload LinkedIn's data export (Shares.csv) instead, which the Voice page already reads. When granted, set it to `true` and check `LINKEDIN_VERSION` in `src/lib/integrations/linkedin.ts` against LinkedIn's current API version.

LinkedIn access tokens last 60 days, and only partners get refresh tokens. After that the page asks the person to reconnect.

**Not built, on purpose:** scraping a LinkedIn profile. It breaks LinkedIn's terms whatever the person consents to, and the export gives the same writing.

## What's next (not built yet)

- **Background sync.** Imports run when the person clicks. A scheduled re-import (say weekly, new sent mail only) needs the job queue (brief §05), which doesn't exist yet.
- **More of Google Workspace.** Same pattern. Each new capability is one entry in `CAPABILITIES`, one importer, and one button.
- **Microsoft 365 / Outlook.** Same pattern, a new provider in `PROVIDERS`.
