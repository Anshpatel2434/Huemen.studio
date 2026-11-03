/**
 * Hosting settings: pool size per instance and the per-minute AI limits have
 * sane defaults, accept a blank value as "use the default", and refuse nonsense.
 */
import { describe, it, expect } from "vitest";
import { parseEnv } from "@/lib/env";

const BASE = { DATABASE_URL: "postgres://x", DATABASE_ADMIN_URL: "postgres://x", DATABASE_APP_PASSWORD: "x", AUTH_SECRET: "0123456789abcdef0123" };

describe("hosting settings", () => {
  it("defaults to a 10-connection pool and 20 / 60 AI calls a minute", () => {
    const env = parseEnv({ ...BASE, DATABASE_POOL_MAX: "", AI_RATE_PER_USER_MINUTE: "" });
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.AI_RATE_PER_USER_MINUTE).toBe(20);
    expect(env.AI_RATE_PER_WORKSPACE_MINUTE).toBe(60);
  });
  it("takes a small pool for serverless and 0 to switch a limit off", () => {
    const env = parseEnv({ ...BASE, DATABASE_POOL_MAX: "2", AI_RATE_PER_WORKSPACE_MINUTE: "0" });
    expect(env.DATABASE_POOL_MAX).toBe(2);
    expect(env.AI_RATE_PER_WORKSPACE_MINUTE).toBe(0);
  });
  it("refuses a pool of zero", () => {
    expect(() => parseEnv({ ...BASE, DATABASE_POOL_MAX: "0" })).toThrow();
  });
});

/**
 * HIDE_MOCK_BADGE silences the only on-screen sign that the copy came from a
 * stub rather than a model. Fine for a demo, never in production — a client
 * would have no way to tell sample copy from their own.
 */
describe("the mock-AI badge", () => {
  it("can be hidden outside production, and reads 1 as well as true", () => {
    expect(parseEnv({ ...BASE, HIDE_MOCK_BADGE: "1" }).HIDE_MOCK_BADGE).toBe(true);
    expect(parseEnv({ ...BASE, HIDE_MOCK_BADGE: "true" }).HIDE_MOCK_BADGE).toBe(true);
    expect(parseEnv({ ...BASE, HIDE_MOCK_BADGE: "" }).HIDE_MOCK_BADGE).toBe(false);
    expect(parseEnv(BASE).HIDE_MOCK_BADGE).toBe(false);
  });
  it("cannot be hidden in production", () => {
    expect(() => parseEnv({ ...BASE, NODE_ENV: "production", HIDE_MOCK_BADGE: "1" })).toThrow(/HIDE_MOCK_BADGE/);
  });
  it("leaves production alone when the flag is not set", () => {
    expect(() => parseEnv({ ...BASE, NODE_ENV: "production" })).not.toThrow();
  });
});
