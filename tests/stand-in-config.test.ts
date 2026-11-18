/**
 * Audit H2b (2026-11-18): the stand-in writer and the stand-in picture maker
 * must not run in production. Development and CI keep mock (vitest pins it).
 * Pure: parseEnv only, no database.
 */
import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

const BASE = { DATABASE_URL: "postgres://x", DATABASE_ADMIN_URL: "postgres://x", DATABASE_APP_PASSWORD: "x" };
const GOOD_SECRET = "a".repeat(64);
// Everything else a production start needs, so only the provider under test can fail.
const PROD = {
  ...BASE,
  NODE_ENV: "production",
  AUTH_DRIVER: "email",
  AUTH_SECRET: GOOD_SECRET,
  MAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_x",
  MAIL_FROM: "a@b.co",
  AI_TEXT_PROVIDER: "groq",
  GROQ_API_KEY: "gsk_test",
  AI_TEXT_MODEL_STRONG: "model-strong",
  AI_TEXT_MODEL_CHEAP: "model-cheap",
  AI_IMAGE_PROVIDER: "openai",
  OPENAI_API_KEY: "sk-test",
  AI_IMAGE_MODEL: "image-model",
};

describe("stand-in providers in production (H2b)", () => {
  it("refuses the stand-in text writer by default (AI_TEXT_PROVIDER defaults to mock)", () => {
    const { AI_TEXT_PROVIDER: _t, GROQ_API_KEY: _k, AI_TEXT_MODEL_STRONG: _s, AI_TEXT_MODEL_CHEAP: _c, ...rest } = PROD;
    expect(() => parseEnv(rest)).toThrow(/AI_TEXT_PROVIDER=mock/);
  });

  it("refuses AI_TEXT_PROVIDER=mock explicitly", () => {
    expect(() => parseEnv({ ...PROD, AI_TEXT_PROVIDER: "mock" })).toThrow(/AI_TEXT_PROVIDER=mock/);
  });

  it("refuses AI_IMAGE_PROVIDER=mock (the stand-in picture maker)", () => {
    expect(() => parseEnv({ ...PROD, AI_IMAGE_PROVIDER: "mock", OPENAI_API_KEY: undefined, AI_IMAGE_MODEL: undefined })).toThrow(/AI_IMAGE_PROVIDER=mock/);
  });

  it("starts in production with real providers", () => {
    const env = parseEnv(PROD);
    expect(env.AI_TEXT_PROVIDER).toBe("groq");
    expect(env.AI_IMAGE_PROVIDER).toBe("openai");
  });

  it("does not refuse the stand-in while next build collects pages", () => {
    expect(() => parseEnv({ ...PROD, AI_TEXT_PROVIDER: "mock", AI_IMAGE_PROVIDER: "mock", NEXT_PHASE: "phase-production-build" })).not.toThrow();
  });

  it("keeps the stand-in in development and test", () => {
    expect(parseEnv({ ...BASE, AUTH_SECRET: GOOD_SECRET }).AI_TEXT_PROVIDER).toBe("mock");
    expect(parseEnv({ ...BASE, NODE_ENV: "test", AUTH_SECRET: GOOD_SECRET, AI_IMAGE_PROVIDER: "mock" }).AI_IMAGE_PROVIDER).toBe("mock");
  });
});
