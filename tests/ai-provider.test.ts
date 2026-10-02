/**
 * The real text provider and the facade's guarantees around it (build step 1).
 *
 * No network and no API key: the Anthropic client is replaced by a stub that
 * records what it was asked and returns what a real reply looks like. What is
 * being tested is OUR side of the boundary — what we send, how we read the
 * reply, and that nothing quietly falls back to the stand-in.
 */
import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { assemblePrompt } from "@/lib/ai/prompt";
import { anthropicTextProvider, type MessagesParser } from "@/lib/ai/providers/anthropic";
import { resolveTextModel, selectImageProvider, selectTextProvider } from "@/lib/ai";
import { AiConfigError, ProviderError, userMessage } from "@/lib/ai/errors";
import { splitDraft } from "@/lib/content/formats";
import { parsePillarLines } from "@/lib/data/pipeline";
import { buildBrandContext } from "@/lib/context/context-builder";
import type { Env } from "@/lib/env";

const context = buildBrandContext({
  brandProfile: { niche: "Leadership coaching for first-time managers" },
  voicePack: { voiceLine: "Finds the big idea in a small moment.", neverWords: ["synergy"] },
});

const env = (over: Partial<Env>): Env =>
  ({
    AI_TEXT_PROVIDER: "mock",
    AI_IMAGE_PROVIDER: "mock",
    AI_TEXT_FALLBACKS: "default",
    AI_TEXT_TIMEOUT_MS: 120000,
    ANTHROPIC_API_KEY: "test-key",
    ...over,
  }) as Env;

/** A stub with the one method the provider uses. Records each request. */
function stubClient(reply: Record<string, unknown> | (() => never)) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          if (typeof reply === "function") return reply();
          return reply;
        },
      },
    },
  } as unknown as MessagesParser;
  return { client, calls };
}

const okReply = (variants: string[], extra: Record<string, unknown> = {}) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  stop_details: null,
  parsed_output: { variants },
  usage: { input_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 900, output_tokens: 300 },
  ...extra,
});

const prompt = assemblePrompt("You write LinkedIn posts in the brand voice.", context, "Format: LinkedIn post\nTopic: delegation", {
  templateKey: "linkedin_post",
  variants: 2,
});

describe("prompt assembly (INV-2)", () => {
  it("puts the template and brand context in the cacheable system block, and the task in the user turn", () => {
    expect(prompt.system).toContain("You write LinkedIn posts");
    expect(prompt.system).toContain("<brand_context>");
    expect(prompt.system).toContain("Finds the big idea in a small moment.");
    expect(prompt.system).not.toContain("delegation");
    expect(prompt.user).toContain("Topic: delegation");
  });

  it("is byte-identical for the same inputs, so the cache prefix holds", () => {
    const again = assemblePrompt("You write LinkedIn posts in the brand voice.", context, "Format: LinkedIn post\nTopic: something else", {
      templateKey: "linkedin_post",
      variants: 2,
    });
    expect(again.system).toBe(prompt.system);
  });

  it("asks for the shape the draft parser reads", () => {
    expect(prompt.user).toContain('starting with "CTA: "');
    expect(prompt.user).toContain("Write 2 distinct versions");
    const parsed = splitDraft("Most managers delegate too late.\n\nHere's the tell.\n\nCTA: What did you hold onto too long?");
    expect(parsed.hook).toBe("Most managers delegate too late.");
    expect(parsed.cta).toBe("What did you hold onto too long?");
  });

  it("asks for the shape the pillar parser reads", () => {
    const p = assemblePrompt("Propose pillars.", context, "Count: 3", { templateKey: "pillar_set" });
    expect(p.user).toContain("Name :: one-line description");
    expect(parsePillarLines("Contrarian takes :: Where I disagree\nProof :: Wins")).toHaveLength(2);
  });
});

describe("provider selection fails loudly", () => {
  it("refuses an unbuilt text provider instead of handing back the stand-in", () => {
    expect(() => selectTextProvider(env({ AI_TEXT_PROVIDER: "openai" }))).toThrow(AiConfigError);
    expect(() => selectTextProvider(env({ AI_TEXT_PROVIDER: "openai" }))).toThrow(/not built/);
  });

  it("refuses an unbuilt image provider", () => {
    expect(() => selectImageProvider(env({ AI_IMAGE_PROVIDER: "replicate" }))).toThrow(AiConfigError);
  });

  it("selects Claude when configured", () => {
    expect(selectTextProvider(env({ AI_TEXT_PROVIDER: "anthropic" })).name).toBe("anthropic");
    expect(selectTextProvider(env({})).name).toBe("mock");
  });

  it("refuses to guess a model for a real provider", () => {
    expect(() => resolveTextModel(env({ AI_TEXT_PROVIDER: "anthropic" }), "strong")).toThrow(/AI_TEXT_MODEL_STRONG/);
    expect(() => resolveTextModel(env({ AI_TEXT_PROVIDER: "anthropic" }), "cheap")).toThrow(/AI_TEXT_MODEL_CHEAP/);
    expect(resolveTextModel(env({ AI_TEXT_PROVIDER: "anthropic", AI_TEXT_MODEL_STRONG: "claude-opus-5-5" }), "strong")).toBe("claude-opus-5-5");
    expect(resolveTextModel(env({}), "strong")).toBe("mock-strong");
  });
});

describe("the Claude provider", () => {
  const config = { fallbacks: "default" as const, timeoutMs: 120000 };

  it("sends the assembled prompt, caches the system block, and opts into refusal fallbacks", async () => {
    const { client, calls } = stubClient(okReply(["One.", "Two."]));
    await anthropicTextProvider(config, client).generate(
      { templateKey: "linkedin_post", context, taskInput: "x", variants: 2, prompt },
      "claude-opus-5-5",
      { effort: "medium" },
    );
    const sent = calls[0] as {
      model: string; system: { text: string; cache_control: unknown }[];
      messages: { content: string }[]; betas: string[]; fallbacks: string;
      output_config: { effort?: string; format: unknown };
    };
    expect(sent.model).toBe("claude-opus-5-5");
    expect(sent.system[0].text).toBe(prompt.system);
    expect(sent.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sent.messages[0].content).toBe(prompt.user);
    expect(sent.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(sent.fallbacks).toBe("default");
    expect(sent.output_config.effort).toBe("medium");
    expect(sent.output_config.format).toBeDefined();
  });

  it("sends no effort when none is configured, and no fallbacks when they are off", async () => {
    const { client, calls } = stubClient(okReply(["One."]));
    await anthropicTextProvider({ ...config, fallbacks: "off" }, client).generate(
      { templateKey: "linkedin_post", context, taskInput: "x", prompt }, "claude-haiku-4-5",
    );
    const sent = calls[0] as Record<string, unknown> & { output_config: Record<string, unknown> };
    expect("effort" in sent.output_config).toBe(false);
    expect("fallbacks" in sent).toBe(false);
    expect("betas" in sent).toBe(false);
  });

  it("returns trimmed variants, capped at the number asked for, and reports the model that served it", async () => {
    const { client } = stubClient(
      okReply(["  First draft.  ", "", "Second draft.", "Third, unasked for."], { model: "claude-opus-4-8" }),
    );
    const r = await anthropicTextProvider(config, client).generate(
      { templateKey: "linkedin_post", context, taskInput: "x", variants: 2, prompt }, "claude-opus-5-5",
    );
    expect(r.variants).toEqual(["First draft.", "Second draft."]);
    // A refusal fallback ran: the log must name the model that wrote it.
    expect(r.model).toBe("claude-opus-4-8");
    expect(r.tokensIn).toBe(1020); // uncached + cache reads + cache writes
    expect(r.tokensOut).toBe(300);
  });

  it("turns a refusal that survived the fallback into an error, not an empty draft", async () => {
    const { client } = stubClient(
      okReply([], { stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } }),
    );
    const err = await anthropicTextProvider(config, client)
      .generate({ templateKey: "linkedin_post", context, taskInput: "x", prompt }, "claude-opus-5-5")
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("refusal");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("cyber");
  });

  it("treats a truncated or unusable reply as a failure", async () => {
    const truncated = stubClient(okReply(["partial"], { stop_reason: "max_tokens" }));
    await expect(
      anthropicTextProvider(config, truncated.client).generate({ templateKey: "x", context, taskInput: "x", prompt }, "m"),
    ).rejects.toMatchObject({ kind: "truncated" });

    const empty = stubClient(okReply(["", "   "]));
    await expect(
      anthropicTextProvider(config, empty.client).generate({ templateKey: "x", context, taskInput: "x", prompt }, "m"),
    ).rejects.toMatchObject({ kind: "unparseable" });
  });

  it("maps SDK errors to provider errors that the facade will not retry a second time", async () => {
    const { client } = stubClient(() => {
      throw new Anthropic.APIConnectionTimeoutError({ message: "Request timed out." });
    });
    const err = await anthropicTextProvider(config, client)
      .generate({ templateKey: "x", context, taskInput: "x", prompt }, "m")
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.kind).toBe("timeout");
    expect(err.retryable).toBe(false);
  });
});

describe("what a person sees when a call fails", () => {
  it("says something plain for each failure, and never mentions AI or the provider", () => {
    const msgs = [
      userMessage(new AiConfigError("AI_TEXT_PROVIDER=anthropic but ANTHROPIC_API_KEY is unset")),
      ...(["timeout", "rate_limit", "auth", "refusal", "server", "unknown"] as const).map((k) => userMessage(new ProviderError(k, "raw"))),
      userMessage(new Error("boom")),
    ];
    for (const m of msgs) {
      expect(m).not.toMatch(/\bAI\b|anthropic|claude|api key|raw|boom/i);
      expect(m.length).toBeGreaterThan(10);
    }
    expect(userMessage(new ProviderError("timeout", "x"))).toMatch(/too long/);
  });
});
