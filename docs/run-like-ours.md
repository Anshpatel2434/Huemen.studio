# Run it the way the 2026-11-18 test run did

The owner's test run (Harrow Lane Growth account, 2026-11-18) used real
models: Groq for text, vision and speech, RunPod for pictures. To get the same
run after pulling `main`:

1. `npm ci`
2. Database (Docker, port 5544): `npm run db:up`, then `npm run db:migrate`
   (applies everything up to `0025_picture_tools`). Seed demo data with
   `npm run db:seed` if the database is new. Never `npm run db:reset` on a
   database you want to keep: it wipes it.
3. Copy `.env.example` to `.env` and set these (keys are your own; never commit
   `.env`):

   | Setting | Value used in the run |
   |---|---|
   | `AI_TEXT_PROVIDER` | `groq` |
   | `AI_TEXT_MODEL_STRONG` | `openai/gpt-oss-120b` |
   | `AI_TEXT_MODEL_CHEAP` | `openai/gpt-oss-20b` |
   | `AI_TEXT_EFFORT_STRONG` / `AI_TEXT_EFFORT_CHEAP` | `medium` / `low` |
   | `AI_TEXT_TIMEOUT_MS` | `120000` |
   | `AI_VISION_MODEL` | `qwen/qwen3.8-27b` (reads the reference designs) |
   | `AI_TRANSCRIBE_PROVIDER` / `AI_TRANSCRIBE_MODEL` | `groq` / `whisper-large-v3-turbo` |
   | `AI_IMAGE_PROVIDER` | `runpod` |
   | `AI_IMAGE_MODEL` / `AI_IMAGE_EDIT_MODEL` | `qwen-image-t2i` / `qwen-image-edit` (RunPod public endpoints, about $0.02 a picture) |
   | `AI_IMAGE_EXTEND_MODEL` | `google-nano-banana-2-edit` (the default; draws the extra area when Resize makes a picture bigger, about $0.09 each) |
   | `AI_IMAGE_ERASE_MODEL` / `AI_IMAGE_ERASE_VARIANT` | `google-nano-banana-2-edit` / `tint` (the defaults; Erase, about $0.09 each) |
   | `AI_CUTOUT_PROVIDER` | `onnx` (Remove background, on this machine's CPU), after `npm run models:fetch` |
   | `AI_PROVIDER_NO_TRAINING` | `true` |
   | `QUEUE_DRIVER` | `pg` |
   | `STORAGE_DRIVER` / `STORAGE_LOCAL_DIR` | `local` / `./.storage` |
   | `AUTH_DRIVER` | `dev` (local sign-in links in the dev inbox) |
   | `APP_URL` | `http://localhost:3120` |
   | `GROQ_API_KEY`, `RUNPOD_API_KEY` | your own keys |
   | `AUTH_SECRET`, `CONNECTIONS_KEY`, database passwords | your own values, as `.env.example` describes |

4. `npm run dev` (port 3120).
5. Checks: `npx tsc --noEmit -p .`, `npm test` (needs the Docker database),
   `npm run lint`.

## Limits worth knowing (free Groq tier)
- About 8,000 input tokens a minute per model. An agent question is about
  4,700; a reading of the reference designs about 5,900. So roughly one agent
  question or one design reading a minute.
- Groq counts every image at a fixed ~1,800 tokens whatever its size, so
  several designs are sent as one numbered contact sheet (lib/visual/look-read).
- The daily allowance ran out twice in one day of testing. With
  `AI_TEXT_FALLBACKS=default`, a strong-model call refused for its daily
  allowance runs once more on `AI_TEXT_MODEL_CHEAP` (its own allowance), so
  work carries on in a plainer voice; both calls are in generation_logs. For
  clients, use a paid Groq plan or set `AI_TEXT_PROVIDER=anthropic`.

- A separate Groq key for the looks (optional): `AI_VISION_API_KEY`. The words
  check after every picture (~3,800 tokens a look) and the design reading then
  have their own allowance instead of waiting behind drafts. When a look still
  can't run, the picture is kept and the board says "Words not checked" with a
  Check for words button; it is never passed off as checked.
- Paid pictures per workspace per day: `AI_IMAGE_DAILY_CAP` (default 60; 0 = no
  daily limit), under the monthly cap. Each picture action also has its own
  budget of paid calls (lib/visual/picture-tools `PICTURE_BUDGET`), said on the
  board before Send or Apply ("Uses 1 to 3 pictures").

## Which key is in use (Runpod and the other provider keys)
Next reads `.env` but never over a variable that is already set, so a key set
outside `.env` (a Windows user environment variable, the host's settings) wins
silently. On 2026-11-19 the `.env` RUNPOD_API_KEY was refused by Runpod (403)
and this PC only worked on a different key from a Windows user variable.
- At every server start the log says, per key, where it came from ("from .env"
  or "from the process environment"), warns when a `.env` line is overridden
  by a different value, and says whether Runpod accepts the key in use (one
  free, read-only call). Values are never printed. (src/instrumentation.ts,
  lib/key-source.ts)
- `npm run check:keys` says the same on demand, and also whether Runpod
  accepts the key written in `.env`.
- The fix is the owner's: put ONE working Runpod key in `.env` (and the same in
  the host's settings), then remove the Windows user variable
  `RUNPOD_API_KEY` (System Properties, Environment Variables), restart the
  terminal and the server, and run `npm run check:keys`.

What changed in this round, and how it was checked: `HANDOVER-2026-11-18-run.md`.
