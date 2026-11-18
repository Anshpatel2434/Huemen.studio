/**
 * The daily-limit fallback (2026-11-18 picture-tools finish): when a strong
 * route call is refused because the model's DAILY allowance is used up, the
 * facade runs the same call once on the cheap route's model, and each attempt
 * writes its own generation_logs row naming the model that ran. Per-minute
 * limits, the cheap route itself and AI_TEXT_FALLBACKS=off keep today's
 * behaviour. No model and no database are reached: the stand-in provider, the
 * session and the rate limiter are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const st = vi.hoisted(() => ({
  /** Per model: an error to throw, or undefined to answer. */
  fail: {} as Record<string, unknown>,
  calls: [] as string[],
  logs: [] as Array<{ model: string; status: string; error: string | null }>,
  env: {} as Record<string, unknown>,
}));

vi.mock("@/lib/ai/providers/mock", () => ({
  mockImageProvider: {},
  mockTextProvider: {
    name: "mock",
    generate: async (_req: unknown, model: string) => {
      st.calls.push(model);
      if (st.fail[model]) throw st.fail[model];
      return { variants: ["A draft."], model, tokensIn: 1, tokensOut: 1 };
    },
    structured: async (_req: unknown, model: string) => {
      st.calls.push(model);
      if (st.fail[model]) throw st.fail[model];
      return { data: { findings: [] }, model, tokensIn: 1, tokensOut: 1 };
    },
    stream: async function* (_req: unknown, model: string) {
      st.calls.push(model);
      if (st.fail[model]) throw st.fail[model];
      yield { type: "delta", text: "Streamed." };
      yield { type: "done", model, tokensIn: 1, tokensOut: 1, text: "Streamed." };
    },
  },
}));
vi.mock("@/lib/ai/templates", () => ({
  resolveTemplate: async (_scope: unknown, key: string) => ({ id: null, key, version: 1, body: "You judge copy." }),
}));
vi.mock("@/lib/ratelimit", () => ({ takeHit: async () => {} }));
vi.mock("@/db/session", () => ({
  withTenantSession: async (_scope: unknown, fn: (c: unknown) => unknown) =>
    fn({
      query: async (sql: string, params: unknown[] = []) => {
        if (/INSERT INTO generation_logs/.test(sql)) {
          st.logs.push({ model: params[2] as string, status: params[7] as string, error: (params[8] as string) ?? null });
          return { rows: [{ id: `00000000-0000-4000-8000-00000000000${st.logs.length}` }] };
        }
        return { rows: [] }; // no cap row: unlimited
      },
    }),
}));
vi.mock("@/lib/env", async (orig) => {
  const real = await orig<typeof import("@/lib/env")>();
  return { ...real, getEnv: () => ({ ...real.getEnv(), ...st.env }) };
});

import { generateText, runTaskStamped, streamText, dailyFallbackRoute } from "@/lib/ai";
import { ProviderError, userMessage } from "@/lib/ai/errors";
import { voiceJudge } from "@/lib/ai/tasks";
import { buildBrandContext } from "@/lib/context/context-builder";
import { getEnv } from "@/lib/env";
import type { SessionScope } from "@/db/session";

const context = buildBrandContext({ brandProfile: { niche: "Leadership coaching" } });
const scope = { tenantId: "11111111-1111-4111-8111-111111111111", userId: null, isPlatformAdmin: false } as unknown as SessionScope;
const STRONG = "big-model";
const CHEAP = "small-model";
const daily = () => new ProviderError("rate_limit", "Groq hit daily rate limit; retry in 3000s.", false, { window: "day", retryAfterSeconds: 3000 });
const minute = () => new ProviderError("rate_limit", "Groq hit per-minute rate limit; retry in 20s.", false, { window: "minute", retryAfterSeconds: 20 });
const draft = { templateKey: "linkedin_post", systemTemplate: "You write.", context, taskInput: "Topic: delegation", variants: 1 };

beforeEach(() => {
  st.fail = {};
  st.calls = [];
  st.logs = [];
  st.env = { AI_TEXT_PROVIDER: "mock", AI_TEXT_MODEL_STRONG: STRONG, AI_TEXT_MODEL_CHEAP: CHEAP, AI_TEXT_FALLBACKS: "default" };
});

describe("daily-limit fallback: the policy (one place)", () => {
  const env = () => ({ ...getEnv() });
  it("falls back from strong to cheap only for a daily rate limit", () => {
    expect(dailyFallbackRoute(env(), "strong", daily())).toBe("cheap");
    expect(dailyFallbackRoute(env(), "strong", minute())).toBeNull();
    expect(dailyFallbackRoute(env(), "strong", new ProviderError("rate_limit", "x"))).toBeNull();
    expect(dailyFallbackRoute(env(), "strong", new ProviderError("server", "x", true))).toBeNull();
    expect(dailyFallbackRoute(env(), "cheap", daily())).toBeNull();
  });
  it("is off with AI_TEXT_FALLBACKS=off, with no cheap model, or when both routes name the same model", () => {
    expect(dailyFallbackRoute({ ...env(), AI_TEXT_FALLBACKS: "off" }, "strong", daily())).toBeNull();
    expect(dailyFallbackRoute({ ...env(), AI_TEXT_PROVIDER: "groq", AI_TEXT_MODEL_CHEAP: undefined }, "strong", daily())).toBeNull();
    expect(dailyFallbackRoute({ ...env(), AI_TEXT_MODEL_CHEAP: STRONG }, "strong", daily())).toBeNull();
  });
});

describe("daily-limit fallback in the facade", () => {
  it("a task (the picture brief path) runs on the cheap model and logs both attempts", async () => {
    st.fail[STRONG] = daily();
    const out = await runTaskStamped(scope, voiceJudge, { context, taskInput: "Lines: one" });
    expect(out.model).toBe(CHEAP);
    expect(st.calls).toEqual([STRONG, CHEAP]);
    expect(st.logs.map((l) => [l.model, l.status])).toEqual([[STRONG, "error"], [CHEAP, "ok"]]);
    expect(st.logs[0].error).toMatch(/daily/);
  });

  it("a draft runs on the cheap model", async () => {
    st.fail[STRONG] = daily();
    const out = await generateText(scope, draft);
    expect(out.model).toBe(CHEAP);
    expect(out.variants).toEqual(["A draft."]);
    expect(st.logs.map((l) => [l.model, l.status])).toEqual([[STRONG, "error"], [CHEAP, "ok"]]);
  });

  it("a stream that failed before showing anything runs on the cheap model", async () => {
    st.fail[STRONG] = daily();
    const evs = [];
    for await (const ev of streamText(scope, draft)) evs.push(ev);
    expect(evs.at(-1)).toMatchObject({ type: "done", model: CHEAP, text: "Streamed." });
    expect(st.logs.map((l) => [l.model, l.status])).toEqual([[STRONG, "error"], [CHEAP, "ok"]]);
  });

  it("when the cheap model is used up too, the person gets the plain daily-limit message", async () => {
    st.fail[STRONG] = daily();
    st.fail[CHEAP] = daily();
    const err = await runTaskStamped(scope, voiceJudge, { context, taskInput: "Lines: one" }).catch((e) => e);
    expect(userMessage(err)).toMatch(/used up its daily allowance/);
    expect(st.calls).toEqual([STRONG, CHEAP]);
    expect(st.logs.map((l) => [l.model, l.status])).toEqual([[STRONG, "error"], [CHEAP, "error"]]);
  });

  it("a per-minute limit is not retried on another model", async () => {
    st.fail[STRONG] = minute();
    const err = await generateText(scope, draft).catch((e) => e);
    expect(userMessage(err)).toMatch(/Too many requests this minute/);
    expect(st.calls).toEqual([STRONG]);
    expect(st.logs).toHaveLength(1);
  });

  it("AI_TEXT_FALLBACKS=off keeps the plain daily-limit failure", async () => {
    st.env.AI_TEXT_FALLBACKS = "off";
    st.fail[STRONG] = daily();
    const err = await runTaskStamped(scope, voiceJudge, { context, taskInput: "Lines: one" }).catch((e) => e);
    expect(userMessage(err)).toMatch(/used up its daily allowance/);
    expect(st.calls).toEqual([STRONG]);
  });

  it("a call already on the cheap route is not retried", async () => {
    st.fail[CHEAP] = daily();
    await expect(generateText(scope, { ...draft, route: "cheap" })).rejects.toThrow(/daily/);
    expect(st.calls).toEqual([CHEAP]);
  });
});
