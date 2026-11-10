# Huemen.studio: what we need from you to switch on the AI

Prepared for Sahil Gandhi, The Brand Professor. 6 October 2026.

## Where things stand

The studio is built and tested end to end on our side. Until now it has run on a stand-in writer, so testing cost nothing and no client data left our machines. We tested:

- the full five-step onboarding for a brand-new client: about you, adding writing, confirming the voice, colours and pillars, and the first piece
- drafting, the on-brand check, pillars, the library and every main screen
- 220 automated checks, including that one client's workspace can never read another's

The stand-in writes formula text on purpose. Real writing quality starts the moment the AI account below is connected. Nothing else in the studio changes when it is.

As agreed in the proposal, running costs sit with you, and every account is opened in your name, so you own it from day one.

## What to set up

### Needed for launch

| What | Why | Typical cost |
|---|---|---|
| **Anthropic (Claude) API account**, at console.anthropic.com, with billing added | Writes every draft, the voice preview, the pre-filled answers and the on-brand check | Pay as you go. Start with USD 50 of credit. See the estimate below. |
| **Web hosting** (we suggest Vercel Pro) | Runs the studio | About USD 20 a month |
| **Database** (managed Postgres; we suggest Supabase Pro, Mumbai region) | Stores every workspace, kept separate per client | About USD 25 a month |
| **File storage** (any S3-compatible store; we suggest Cloudflare R2) | Logos, headshots, uploads | Free up to 10 GB, then cents per GB |
| **Domain** | Your own address for the studio | About USD 10 to 20 a year |
| **Email sending** (we suggest Resend) | Sign-in links and invites | Free up to 3,000 emails a month, then about USD 20 a month |
| **Google Cloud project** in your Google account | Clients sign in with Google and we read their **sent email** once. It's the fastest way to learn a voice. | Free. See "Gmail at launch" below. |

Prices are the providers' public list prices as we last saw them. Please check them when you sign up.

### Optional, and fine to add later

| What | Why | Cost and catch |
|---|---|---|
| **OpenAI API account** | Voice notes: clients answer questions out loud instead of typing | About USD 0.003 to 0.006 per minute of audio. A full onboarding is under 10 minutes. |
| **Google Docs, Calendar and YouTube** | Clients connect these so the studio can read more of their writing | Same Google project, no extra cost. Google reviews the app before the public can use these, which takes days to weeks. |
| **LinkedIn developer app** | Reading a client's LinkedIn posts directly | Free, but reading posts needs LinkedIn's partner approval, which isn't guaranteed. Until then, clients upload their LinkedIn export, which already works. |
| **Font licence** | The typeface in the hueman design system | Please confirm the licence and price with the foundry. |

## Gmail at launch

In onboarding, a client clicks **Sign in with Google** and approves. We then read every email they sent in the last two years (up to 2,000) and learn how they write: the words they reach for, how they open and close, what they explain again and again. When the read is done, we withdraw our access. We never read their inbox or anyone else's replies, and their email is never quoted in a draft.

Google normally requires a paid yearly security assessment before an app can read Gmail. Until an app has one, Google lets it run for **up to 100 invited people**, which covers your first clients. Two practical points:

- For each new client, your team adds their Gmail address to the project's invited list before onboarding. We'll show you where; it takes a minute.
- Clients will see a "Google hasn't verified this app" screen and click **Advanced → Continue**. We'll put a line about it in the welcome email so nobody is surprised.

Past 100 clients, or to remove that screen, Google's assessment is needed. It usually costs a few hundred to a few thousand USD a year, and that's a decision for later.

## What the AI will cost to run

These are estimates from the real prompt sizes the studio sends: 3,600 to 7,000 tokens per request, where a token is about three-quarters of a word. The usage page in the studio shows the real numbers once you're live.

The studio uses two kinds of request:

- **Writing**: drafts and rewrites. These need the best model.
- **Light work**: previews, pre-fill and checks. A small, fast model handles these.

Price per million tokens, input / output: Claude Opus 5.5 is USD 4 / 20, Claude Sonnet 5.5 is USD 2 / 10, and Claude Haiku 4.5 is about USD 1 / 5.

| Setup | Per piece written | One client's onboarding | One active client a month (about 30 pieces) | 10 active clients a month |
|---|---|---|---|---|
| **Best quality:** Opus 5.5 for writing, Haiku 4.5 for light work | about USD 0.08 | about USD 0.50 to 1 | about USD 5 | about USD 50 |
| **Balanced:** Sonnet 5.5 for writing, Haiku 4.5 for light work | about USD 0.04 | about USD 0.30 to 0.60 | about USD 3 | about USD 30 |

Our recommendation is to start on **Best quality**. Voice is the whole product, and the difference between the two is a few dollars per client a month. Both models are switches in the settings, so you can change your mind at any time with no code change.

On top of the AI, hosting, database, storage and email come to roughly **USD 50 to 70 a month** at launch.

## Decisions we need from you

1. **Model tier:** Best quality or Balanced. We recommend Best quality.
2. **AI-generated images, yes or no.** Today, visuals are built from your brand templates (colours, fonts, logo), so there is no image-model cost. If you want AI-generated photos or illustrations as well, that's a separate image provider and cost, and we'll quote it.
3. **LinkedIn partner application:** do you want us to apply in your name?
4. **Region:** we suggest hosting in Mumbai, with UK users still well served. Tell us if most clients are in the UK.

## How to give us access safely

Please **never send keys or passwords by email or WhatsApp.** For each account above:

- **Anthropic, hosting, database and Google Cloud:** open the account in your name and invite us as a member, at developer or admin level (on Google Cloud, the "Editor" role). We'll create the keys inside the account.
- If you'd rather create a key yourself, paste it straight into the hosting provider's environment settings, not into a message.

Anthropic doesn't train its models on API data under its commercial terms, and the studio records that setting, so client writing stays private.

## What happens next

1. You open the accounts and invite us.
2. We connect them. Then one person runs through onboarding with real writing, and we tune the voice before any client sees it.
3. We finish the last launch items on our side: live sign-in emails and invites, the storage connection, and downloadable images. Then we roll out to your first clients.
