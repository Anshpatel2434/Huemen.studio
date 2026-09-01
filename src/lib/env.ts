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
  AI_TEXT_MODEL_STRONG: z.string().optional(),
  AI_TEXT_MODEL_CHEAP: z.string().optional(),
  AI_IMAGE_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  REPLICATE_API_TOKEN: z.string().optional(),
  // Contractual: client data never used for provider training/eval (brief §07).
  AI_PROVIDER_NO_TRAINING: z
    .string()
    .default("true")
    .transform((v) => v === "true"),

  QUEUE_DRIVER: z.enum(["pg", "redis"]).default("pg"),
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
