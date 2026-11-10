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
