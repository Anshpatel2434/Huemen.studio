/**
 * Audit H3 (2026-11-18), the facade's guard: a draft is kept only when the text
 * the person watched is the text the provider ends with. The stand-in stream
 * is stubbed to produce each case; no model is called.
 */
import { describe, it, expect, vi } from "vitest";

const st = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/ai/providers/mock", () => ({
  mockImageProvider: {},
  mockTextProvider: {
    name: "mock",
    generate: async () => {
      throw new Error("not used");
    },
    structured: async () => {
      throw new Error("not used");
    },
    stream: async function* () {
      for (const e of st.events) yield e;
    },
  },
}));

import { streamText } from "@/lib/ai";
import { buildBrandContext } from "@/lib/context/context-builder";
import type { SessionScope } from "@/db/session";

const context = buildBrandContext({ brandProfile: { niche: "Leadership coaching" } });
const scope = { tenantId: null, userId: null, isPlatformAdmin: false } as unknown as SessionScope;
const req = { templateKey: "linkedin_post", systemTemplate: "You write.", context, taskInput: "Topic: delegation", variants: 2 };

async function collect() {
  const out: Array<Record<string, unknown>> = [];
  for await (const ev of streamText(scope, req)) out.push(ev as Record<string, unknown>);
  return out;
}

describe("streamText keeps only the text the person watched (audit H3)", () => {
  it("finishes with the streamed text when the provider's final text is the same", async () => {
    st.events = [
      { type: "delta", text: "Hook one\n" },
      { type: "delta", text: "Body." },
      { type: "done", model: "mock-strong", tokensIn: 1, tokensOut: 1, text: "Hook one\nBody." },
    ];
    const out = await collect();
    expect(out.at(-1)).toMatchObject({ type: "done", text: "Hook one\nBody." });
  });

  it("refuses the draft when the provider ends with different words from the ones shown", async () => {
    st.events = [
      { type: "delta", text: "The first model's words." },
      { type: "done", model: "mock-strong", tokensIn: 1, tokensOut: 1, text: "The kept words." },
    ];
    await expect(collect()).rejects.toThrow(/changed while it was being written, so it was not kept/);
  });
});
