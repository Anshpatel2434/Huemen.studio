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
  DATABASE_APP_PASSWORD: z.string().min(1),

  // Auth
  AUTH_SECRET: z.string().min(16),
  AUTH_DRIVER: z.enum(["dev", "managed"]).default("dev"),

  // Storage
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./.storage"),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_S3_ENDPOINT: z.string().optional(),

  // AI layer — model choice is config, never hardcoded (brief §05).
  AI_TEXT_PROVIDER: z.enum(["mock", "openai", "anthropic"]).default("mock"),
  AI_IMAGE_PROVIDER: z.enum(["mock", "openai", "replicate"]).default("mock"),
  // Required once a real text provider is chosen; the facade refuses to run
  // without them rather than guessing a model. See .env.example.
  AI_TEXT_MODEL_STRONG: z.string().optional(),
  AI_TEXT_MODEL_CHEAP: z.string().optional(),
  // Thinking depth per route. Left unset, nothing is sent: some models reject
  // the parameter, so it is opt-in per deployment rather than assumed.
  AI_TEXT_EFFORT_STRONG: z.preprocess(blankIsUnset, z.enum(EFFORT).optional()),
  AI_TEXT_EFFORT_CHEAP: z.preprocess(blankIsUnset, z.enum(EFFORT).optional()),
  // Server-side refusal fallbacks on the Claude API. On by default.
  AI_TEXT_FALLBACKS: z.preprocess(blankIsUnset, z.enum(["default", "off"]).default("default")),
  // Per request. Generation still runs in the request thread (no job queue
  // yet), so this bounds how long a click can hang.
  AI_TEXT_TIMEOUT_MS: z.preprocess(blankIsUnset, z.coerce.number().int().positive().default(120000)),
  AI_IMAGE_MODEL: z.string().optional(),
  // Speech to text for voice notes. Claude reads text, not audio, so this is a
  // separate provider. "off" means the page offers typing instead of recording.
  AI_TRANSCRIBE_PROVIDER: z.preprocess(blankIsUnset, z.enum(["off", "openai"]).default("off")),
  AI_TRANSCRIBE_MODEL: z.preprocess(blankIsUnset, z.string().optional()),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  REPLICATE_API_TOKEN: z.string().optional(),
  // Contractual: client data never used for provider training/eval (brief §07).
  AI_PROVIDER_NO_TRAINING: z
    .string()
    .default("true")
    .transform((v) => v === "true"),

  QUEUE_DRIVER: z.enum(["pg", "redis"]).default("pg"),

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
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n` +
        `Copy .env.example to .env and fill in the values.`,
    );
  }
  cached = parsed.data;
  return cached;
}
