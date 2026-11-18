/**
 * Audit M1 (randomness controls) and L2 (fewer versions than asked, said
 * plainly), 2026-11-18. No model is called: the providers get stub fetch and
 * SDK clients, and the facade gets a stub stand-in provider.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const spy = vi.hoisted(() => ({
  generateOpts: [] as Array<Record<string, unknown> | undefined>,
  structuredOpts: [] as Array<Record<string, unknown> | undefined>,
  generateVariants: ["Only one version."] as string[],
}));

vi.mock("@/lib/ai/providers/mock", () => ({
  mockImageProvider: {},
  mockTextProvider: {
    name: "mock",
    generate: async (_req: unknown, _model: string, opts?: Record<string, unknown>) => {
      spy.generateOpts.push(opts);
      return { variants: spy.generateVariants, model: "mock-strong", tokensIn: 1, tokensOut: 1 };
    },
    structured: async (_req: unknown, _model: string, _schema: unknown, opts?: Record<string, unknown>) => {
      spy.structuredOpts.push(opts);
      return { data: { findings: [] }, model: "mock-strong", tokensIn: 1, tokensOut: 1 };
    },
    stream: async function* () {},
  },
}));
vi.mock("@/lib/ai/templates", () => ({
  resolveTemplate: async (_scope: unknown, key: string) => ({ id: null, key, version: 1, body: "You judge copy." }),
}));

import { buildBrandContext } from "@/lib/context/context-builder";
import { assemblePrompt } from "@/lib/ai/prompt";
import { anthropicTextProvider, type MessagesParser } from "@/lib/ai/providers/anthropic";
import { groqTextProvider } from "@/lib/ai/providers/groq";
import { generateText, runTaskStamped, temperatureFor, TEMPERATURE } from "@/lib/ai";
import { voiceJudge, topicProposals, rewriteInVoice, rewritePart } from "@/lib/ai/tasks";
import type { SessionScope } from "@/db/session";

const context = buildBrandContext({ brandProfile: { niche: "Leadership coaching for first-time managers" } });
const prompt = assemblePrompt("You write LinkedIn posts.", context, "Format: LinkedIn post\nTopic: delegation", { templateKey: "linkedin_post", variants: 2 });
const scope = { tenantId: null, userId: null, isPlatformAdmin: false } as unknown as SessionScope;

beforeEach(() => {
  spy.generateOpts = [];
  spy.structuredOpts = [];
  spy.generateVariants = ["Only one version."];
});

describe("temperature by use (M1)", () => {
  it("runs judgements and rewrites low, drafts moderate, and leaves other tasks to the provider default", () => {
    expect(temperatureFor(voiceJudge.key)).toBe(TEMPERATURE.judge);
    expect(temperatureFor(rewriteInVoice.key)).toBe(TEMPERATURE.rewrite);
    expect(temperatureFor(rewritePart.key)).toBe(TEMPERATURE.rewrite);
    expect(temperatureFor(topicProposals.key)).toBeUndefined();
    expect(TEMPERATURE.judge).toBeLessThan(TEMPERATURE.rewrite);
    expect(TEMPERATURE.rewrite).toBeLessThan(TEMPERATURE.draft);
  });

  it("the facade hands a judgement its low temperature and a draft its moderate one", async () => {
    await runTaskStamped(scope, voiceJudge, { context, taskInput: "Lines: one" });
    expect(spy.structuredOpts.at(-1)?.temperature).toBe(TEMPERATURE.judge);
    await generateText(scope, { templateKey: "linkedin_post", systemTemplate: "You write.", context, taskInput: "x", variants: 1 });
    expect(spy.generateOpts.at(-1)?.temperature).toBe(TEMPERATURE.draft);
  });
});

describe("the Groq request carries the temperature when one is chosen (M1)", () => {
  function fakeFetch(bodies: Record<string, unknown>[]) {
    return async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const reply = { model: "m", choices: [{ message: { content: JSON.stringify({ variants: ["A draft."] }) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    };
  }

  it("sends temperature when given, and nothing when not", async () => {
    const bodies: Record<string, unknown>[] = [];
    const p = groqTextProvider({ apiKey: "k", timeoutMs: 5000 }, fakeFetch(bodies));
    await p.generate({ templateKey: "x", context, taskInput: "x", prompt, variants: 1 }, "m", { temperature: 0.2 });
    await p.generate({ templateKey: "x", context, taskInput: "x", prompt, variants: 1 }, "m");
    expect(bodies[0].temperature).toBe(0.2);
    expect("temperature" in bodies[1]).toBe(false);
  });
});

describe("the Claude request carries the temperature only where no thinking depth is set (M1)", () => {
  function stub() {
    const calls: Record<string, unknown>[] = [];
    const reply = { model: "claude-x", stop_reason: "end_turn", stop_details: null, parsed_output: { variants: ["A draft."] }, usage: { input_tokens: 1, output_tokens: 1 } };
    const client = {
      beta: { messages: { parse: async (params: Record<string, unknown>) => { calls.push(params); return reply; } } },
    } as unknown as MessagesParser;
    return { client, calls };
  }

  it("sends temperature with no effort, and leaves it out when effort is set", async () => {
    const { client, calls } = stub();
    const p = anthropicTextProvider({ fallbacks: "off", timeoutMs: 1000 }, client);
    await p.generate({ templateKey: "x", context, taskInput: "x", prompt, variants: 1 }, "claude-x", { temperature: 0.2 });
    await p.generate({ templateKey: "x", context, taskInput: "x", prompt, variants: 1 }, "claude-x", { temperature: 0.2, effort: "medium" });
    expect(calls[0].temperature).toBe(0.2);
    expect("temperature" in calls[1]).toBe(false);
  });
});

describe("fewer versions than asked for are reported (L2)", () => {
  it("keeps what came back and says how many versions it was short by", async () => {
    spy.generateVariants = ["Only one version."];
    const out = await generateText(scope, { templateKey: "linkedin_post", systemTemplate: "You write.", context, taskInput: "x", variants: 2 });
    expect(out.variants).toEqual(["Only one version."]);
    expect(out.warnings).toEqual(["The model returned 1 of the 2 versions asked for."]);
  });

  it("reports nothing when every version came back", async () => {
    spy.generateVariants = ["One.", "Two."];
    const out = await generateText(scope, { templateKey: "linkedin_post", systemTemplate: "You write.", context, taskInput: "x", variants: 2 });
    expect(out.warnings).toEqual([]);
  });
});
