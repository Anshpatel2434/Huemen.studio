/**
 * Validated environment configuration.
 *
 * Secrets live in the environment only, never in source (brief §07). This module
 * is the single place env vars are read and type-checked; feature code imports
 * typed values from here rather than touching `process.env` directly.
 *
 * Server-side config. Imported by both the Next server runtime and CLI scripts
 * (migrate/seed), so it deliberately does not use the `server-only` guard.
 */
import { z } from "zod";

/** An env var left blank in .env (`KEY=`) means "not set", not an empty value. */
const blankIsUnset = (v: unknown) => (v === "" ? undefined : v);
const EFFORT = ["low", "medium", "high", "xhigh", "max"] as const;

const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Database — runtime (RLS-enforced, non-owner) + admin (migrations only).
  DATABASE_URL: z.string().min(1),
  DATABASE_ADMIN_URL: z.string().min(1),
  // Connections each server instance may hold. 10 suits one long-running
  // server; on Vercel every function instance has its own pool, so keep it at
  // 1 to 3 there and point DATABASE_URL at a pooler (Supabase :6543).
  DATABASE_POOL_MAX: z.preprocess(blankIsUnset, z.coerce.number().int().min(1).max(50).default(10)),
  DATABASE_APP_PASSWORD: z.string().min(1),

  // Auth. "dev": one-click sign-in for seeded accounts and links shown on screen.
  // "email": one-time sign-in links and invites sent by email (production).
  // "managed" is the old name for "email" and still accepted.
  AUTH_SECRET: z.string().min(16),
  AUTH_DRIVER: z.preprocess((v) => (v === "managed" ? "email" : v), z.enum(["dev", "email"]).default("dev")),
  // A production server refuses AUTH_DRIVER=dev (anyone could sign in as
  // anyone) unless this says so: only for a throwaway test deploy behind the
  // host's own access protection (Vercel Deployment Protection).
  AUTH_ALLOW_DEV_SIGNIN: z.preprocess(blankIsUnset, z.enum(["true", "false"]).default("false")).transform((v) => v === "true"),
  // Sign-in with a password (migration 0028), for a host with no email service
  // yet: set when an invite is accepted, or by scripts/set-password.ts. Still
  // invite-only. With MAIL_PROVIDER=log the email-link form is hidden, and an
  // admin copies an invite link from the admin console and sends it by hand.
  AUTH_PASSWORD_SIGNIN: z.preprocess(blankIsUnset, z.enum(["true", "false"]).default("false")).transform((v) => v === "true"),

  // Outbound email (sign-in links, invites). "log" writes them to the server log.
  MAIL_PROVIDER: z.preprocess(blankIsUnset, z.enum(["log", "resend"]).default("log")),
  RESEND_API_KEY: z.preprocess(blankIsUnset, z.string().optional()),
  /** The sender, e.g. "Huemen.studio <studio@yourdomain.com>", on a domain verified with the provider. */
  MAIL_FROM: z.preprocess(blankIsUnset, z.string().optional()),

  // Storage
  STORAGE_DRIVER: z.enum(["local", "s3", "pg"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./.storage"),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_S3_ENDPOINT: z.string().optional(),

  // AI layer — model choice is config, never hardcoded (brief §05).
  AI_TEXT_PROVIDER: z.enum(["mock", "openai", "anthropic", "groq"]).default("mock"),
  AI_IMAGE_PROVIDER: z.enum(["mock", "openai", "runpod", "replicate"]).default("mock"),
  // Required once a real text provider is chosen; the facade refuses to run
  // without them rather than guessing a model. See .env.example.
  AI_TEXT_MODEL_STRONG: z.string().optional(),
  AI_TEXT_MODEL_CHEAP: z.string().optional(),
  // The model that LOOKS at pictures (reading a person's reference designs),
  // on the same provider as text. On Groq name a vision model (e.g.
  // qwen/qwen3.8-27b); on Anthropic, unset means the strong model. Not a
  // start-up refusal when missing: only the design reading needs it, and it
  // fails visibly (and is logged) with a config message until it is set.
  AI_VISION_MODEL: z.preprocess(blankIsUnset, z.string().optional()),
  // Groq only: a key of its own for the model that looks at pictures (the
  // words check after a picture is drawn, design reading). Each Groq key has
  // its own per-minute and daily allowance, so the looks no longer wait behind
  // drafts and briefs (PI-40). Unset: GROQ_API_KEY is used, as before.
  AI_VISION_API_KEY: z.preprocess(blankIsUnset, z.string().optional()),
  // Thinking depth per route. Left unset, nothing is sent: some models reject
  // the parameter, so it is opt-in per deployment rather than assumed.
  AI_TEXT_EFFORT_STRONG: z.preprocess(blankIsUnset, z.enum(EFFORT).optional()),
  AI_TEXT_EFFORT_CHEAP: z.preprocess(blankIsUnset, z.enum(EFFORT).optional()),
  // Server-side refusal fallbacks on the Claude API. On by default.
  AI_TEXT_FALLBACKS: z.preprocess(blankIsUnset, z.enum(["default", "off"]).default("default")),
  // Per request. Generation still runs in the request thread (no job queue
  // yet), so this bounds how long a click can hang.
  AI_TEXT_TIMEOUT_MS: z.preprocess(blankIsUnset, z.coerce.number().int().positive().default(120000)),
  // Short-window limits on model calls (lib/ratelimit), per person and per
  // workspace, per minute. 0 turns one off. The monthly cap is separate.
  AI_RATE_PER_USER_MINUTE: z.preprocess(blankIsUnset, z.coerce.number().int().min(0).default(20)),
  AI_RATE_PER_WORKSPACE_MINUTE: z.preprocess(blankIsUnset, z.coerce.number().int().min(0).default(60)),
  // Paid pictures one workspace may use in one day (every image model call
  // counts, kept or refused; Remove background is free and does not). A
  // backstop under the monthly cap so a run of retries can't spend a month in
  // an afternoon (PI-30). 0 turns it off.
  AI_IMAGE_DAILY_CAP: z.preprocess(blankIsUnset, z.coerce.number().int().min(0).default(60)),
  // Pictures (ChatGPT Image through OpenAI's Images API). The model name is
  // config, e.g. the current GPT Image model; the app never guesses one.
  AI_IMAGE_MODEL: z.preprocess(blankIsUnset, z.string().optional()),
  // Runpod only: the endpoint that redraws an area (image in, image out).
  AI_IMAGE_EDIT_MODEL: z.preprocess(blankIsUnset, z.string().optional()),
  // Runpod only: the endpoint that fills a bigger frame (Resize on the Visual
  // board, where the new shape is larger than the picture). It gets the whole
  // picture on a flat matte, so it must be a model that edits by instruction
  // and keeps the rest still.
  AI_IMAGE_EXTEND_MODEL: z.preprocess(blankIsUnset, z.string().default("google-nano-banana-2-edit")),
  // Runpod only: the endpoint that erases what is brushed over (Erase on the
  // Visual board), and how it is shown what goes: "tint" (painted magenta),
  // "clean" (described as "the object in the middle") or "fill" (cleared and
  // filled from around it first). Live 2026-11-18: qwen-image-edit kept a thin
  // rod with "clean" and drew a blob with "fill".
  AI_IMAGE_ERASE_MODEL: z.preprocess(blankIsUnset, z.string().default("google-nano-banana-2-edit")),
  AI_IMAGE_ERASE_VARIANT: z.preprocess(blankIsUnset, z.enum(["tint", "clean", "fill"]).default("tint")),
  // Remove background on the Visual board: an open model run inside the app
  // (lib/ai/providers/cutout-onnx), no cost per use. "off" (the default) shows
  // the tool disabled with the reason; "onnx" needs the model file at
  // AI_CUTOUT_MODEL_PATH (npm run models:fetch); "mock" is the stand-in for
  // development and tests.
  AI_CUTOUT_PROVIDER: z.preprocess(blankIsUnset, z.enum(["off", "onnx", "mock"]).default("off")),
  AI_CUTOUT_MODEL_PATH: z.preprocess(blankIsUnset, z.string().default("./models/isnet-general-use.onnx")),
  RUNPOD_API_KEY: z.preprocess(blankIsUnset, z.string().optional()),
  // A picture or an area redraw can take a while; bounded per call.
  AI_IMAGE_TIMEOUT_MS: z.preprocess(blankIsUnset, z.coerce.number().int().positive().default(180000)),
  // Speech to text for voice notes. Claude reads text, not audio, so this is a
  // separate provider. "off" means the page offers typing instead of recording.
  AI_TRANSCRIBE_PROVIDER: z.preprocess(blankIsUnset, z.enum(["off", "openai", "groq"]).default("off")),
  AI_TRANSCRIBE_MODEL: z.preprocess(blankIsUnset, z.string().optional()),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  // Contractual: client data is never used for provider training or
  // evaluation (brief §07). The operator confirms the provider account is set
  // up that way by leaving this true; a real provider refuses to start
  // without it (configProblems). Recorded in docs/decisions.md.
  AI_PROVIDER_NO_TRAINING: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  // Client demos on the stand-in writer: hide the "Mock AI" badge in the
  // editor header. The copy is still sample copy.
  HIDE_MOCK_BADGE: z.preprocess(blankIsUnset, z.enum(["0", "1"]).default("0")).transform((v) => v === "1"),

  // Background jobs (lib/jobs): the secret a scheduler sends to GET /api/cron
  // as "Authorization: Bearer <secret>". Unset, the route refuses every call
  // and jobs still run after the request that queued them and while a page
  // watches them; the cron catches retries nobody is watching.
  CRON_SECRET: z.preprocess(blankIsUnset, z.string().min(16).optional()),

  // Connections (Gmail, Google Docs, Google Calendar, LinkedIn). Each provider
  // is off until its client id and secret are set; the page says so instead of
  // showing a button that fails. Tokens are sealed with CONNECTIONS_KEY
  // (32 random bytes, base64) before they reach the database.
  CONNECTIONS_KEY: z.preprocess(blankIsUnset, z.string().optional()),
  GOOGLE_CLIENT_ID: z.preprocess(blankIsUnset, z.string().optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(blankIsUnset, z.string().optional()),
  // For the Google Docs picker: a browser API key and the Cloud project number.
  GOOGLE_PICKER_API_KEY: z.preprocess(blankIsUnset, z.string().optional()),
  GOOGLE_PROJECT_NUMBER: z.preprocess(blankIsUnset, z.string().optional()),
  LINKEDIN_CLIENT_ID: z.preprocess(blankIsUnset, z.string().optional()),
  LINKEDIN_CLIENT_SECRET: z.preprocess(blankIsUnset, z.string().optional()),
  // Reading a member's own posts needs LinkedIn partner approval
  // (r_member_social). Leave false until LinkedIn has granted it.
  LINKEDIN_POSTS_APPROVED: z.preprocess(blankIsUnset, z.enum(["true", "false"]).default("false").transform((v) => v === "true")),

  // Error tracking (lib/observability/report). Optional: without a DSN errors
  // are only written to the log. The Sentry account must be in the client's
  // own name; the DSN is the project's "Client Keys (DSN)" value.
  SENTRY_DSN: z.preprocess(blankIsUnset, z.string().url().optional()),
  /** Tags each event, e.g. "production" or "preview". Defaults to NODE_ENV. */
  SENTRY_ENVIRONMENT: z.preprocess(blankIsUnset, z.string().max(64).optional()),
});

export type Env = z.infer<typeof schema>;

/**
 * Settings that are each valid but don't work together. Email sign-in with no
 * way to send the email would let nobody in, so it stops the app at start-up
 * instead of failing on the first sign-in.
 */
export function configProblems(env: Env, phase?: string): string[] {
  const out: string[] = [];
  if (env.AI_IMAGE_PROVIDER === "openai") {
    if (!env.OPENAI_API_KEY) out.push("AI_IMAGE_PROVIDER=openai needs OPENAI_API_KEY (paste it in the hosting settings, never in code).");
    if (!env.AI_IMAGE_MODEL) out.push("AI_IMAGE_PROVIDER=openai needs AI_IMAGE_MODEL, the current GPT Image model name.");
  }
  if (env.AI_IMAGE_PROVIDER === "runpod") {
    if (!env.RUNPOD_API_KEY) out.push("AI_IMAGE_PROVIDER=runpod needs RUNPOD_API_KEY (paste it in the hosting settings, never in code).");
    if (!env.AI_IMAGE_MODEL) out.push("AI_IMAGE_PROVIDER=runpod needs AI_IMAGE_MODEL, a Runpod public endpoint id such as qwen-image-t2i.");
  }
  if (env.AI_TEXT_PROVIDER === "groq" && !env.GROQ_API_KEY) out.push("AI_TEXT_PROVIDER=groq needs GROQ_API_KEY (paste it in the hosting settings, never in code).");
  if (env.AI_TRANSCRIBE_PROVIDER === "groq" && !env.GROQ_API_KEY) out.push("AI_TRANSCRIBE_PROVIDER=groq needs GROQ_API_KEY.");
  if ((env.AI_TEXT_PROVIDER !== "mock" || env.AI_IMAGE_PROVIDER !== "mock") && !env.AI_PROVIDER_NO_TRAINING) {
    out.push("AI_PROVIDER_NO_TRAINING is false: client data must never be used for model training (brief §07). Set the provider account to no-training, then set AI_PROVIDER_NO_TRAINING=true.");
  }
  // Production refusals. Not while `next build` collects pages: the build
  // runs as production but serves nobody, and CI builds with test settings.
  if (env.NODE_ENV === "production" && phase !== "phase-production-build") {
    // The stand-in writes sample copy that is saved as a real piece. It is for
    // development and CI only; a production deployment must name a real provider.
    if (env.AI_TEXT_PROVIDER === "mock") {
      out.push("AI_TEXT_PROVIDER=mock is the stand-in writer (sample copy, saved as real pieces). Production needs AI_TEXT_PROVIDER=anthropic or groq.");
    }
    if (env.AI_IMAGE_PROVIDER === "mock") {
      out.push("AI_IMAGE_PROVIDER=mock is the stand-in picture maker. Production needs AI_IMAGE_PROVIDER=openai or runpod.");
    }
    if (env.AI_CUTOUT_PROVIDER === "mock") {
      out.push("AI_CUTOUT_PROVIDER=mock is the stand-in for background removal. Production needs AI_CUTOUT_PROVIDER=onnx (with the model file) or off.");
    }
    if (env.AUTH_DRIVER === "dev" && !env.AUTH_ALLOW_DEV_SIGNIN) {
      out.push("AUTH_DRIVER=dev lets anyone sign in as anyone. Use AUTH_DRIVER=email in production (or AUTH_ALLOW_DEV_SIGNIN=true for a protected throwaway test only).");
    }
    if (env.AUTH_SECRET.length < 32 || /change[_-]?me/i.test(env.AUTH_SECRET)) {
      out.push("AUTH_SECRET is the example value or shorter than 32 characters; it signs every session. Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
    }
  }
  if (env.AUTH_DRIVER === "email" && env.MAIL_PROVIDER === "log" && !env.AUTH_PASSWORD_SIGNIN) {
    out.push("AUTH_DRIVER=email sends sign-in links by email: set MAIL_PROVIDER=resend (MAIL_PROVIDER=log only writes them to the server log), or AUTH_PASSWORD_SIGNIN=true to sign in with passwords until email is set up.");
  }
  if (env.STORAGE_DRIVER === "s3") {
    const missing = (["STORAGE_S3_BUCKET", "STORAGE_S3_REGION", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY"] as const).filter((k) => !env[k]);
    if (missing.length) out.push(`STORAGE_DRIVER=s3 needs ${missing.join(", ")} (and STORAGE_S3_ENDPOINT for Supabase Storage or R2).`);
  }
  if (env.MAIL_PROVIDER === "resend") {
    if (!env.RESEND_API_KEY) out.push("MAIL_PROVIDER=resend needs RESEND_API_KEY.");
    if (!env.MAIL_FROM) out.push('MAIL_PROVIDER=resend needs MAIL_FROM, e.g. "Huemen.studio <studio@yourdomain.com>" on a verified domain.');
  }
  return out;
}

let cached: Env | null = null;

/** Validate a set of variables (process.env, or a test's own). Throws with every problem listed. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n` +
        `Copy .env.example to .env and fill in the values.`,
    );
  }
  const problems = configProblems(parsed.data, source.NEXT_PHASE);
  if (problems.length) throw new Error(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  return parsed.data;
}

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
