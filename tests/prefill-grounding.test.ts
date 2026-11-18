/**
 * Audit M6 (2026-11-18): prefill suggestions are kept only when they are in the
 * person's own material, and the cache basis moves when stories, proofs or
 * strategy answers change. The model, the database and onboarding are stubs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const st = vi.hoisted(() => ({
  answers: [] as Array<{ id: string; value: string; evidence: string }>,
  saved: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/ai", () => ({
  runTask: async () => ({ answers: st.answers }),
}));
vi.mock("@/lib/data/foundation", () => ({
  loadFoundation: async () => ({ niche: "", audience: "first-time managers", positioning: "", offers: "" }),
  loadBriefAnswers: async () => [],
}));
vi.mock("@/lib/data/voice-pack", () => ({
  listSamples: async () => [{ visibility: "public", body: "I help first-time managers delegate without losing the thread.", channel: "linkedin" }],
}));
vi.mock("@/lib/data/onboarding", () => ({
  updateOnboarding: async (_scope: unknown, _pack: unknown, patch: Record<string, unknown>) => {
    st.saved = patch;
  },
}));
vi.mock("@/lib/context/context-loader", async () => {
  const { buildBrandContext } = await import("@/lib/context/context-builder");
  const ctx = buildBrandContext({ voicePack: { neverWords: ["synergy"] } });
  return { loadBrandContext: async () => ctx };
});

import { basisFrom, groundedIn, normalForMatch, suggestAnswers } from "@/lib/data/enrich";
import type { WorkspaceScope } from "@/lib/data/projects";

const scope = { tenantId: "22222222-2222-4222-8222-222222222222", userId: null, isPlatformAdmin: false } as unknown as WorkspaceScope;

function packWith(identity: Record<string, unknown> = {}) {
  return { id: "p1", version: 1, corpusStats: { pieces: 1 }, onboarding: {}, identity } as never;
}

beforeEach(() => {
  st.saved = null;
  st.answers = [];
});

describe("what a suggestion is checked against (M6)", () => {
  it("folds case, curly quotes and spacing before comparing", () => {
    expect(normalForMatch("  “First-time   Managers” ")).toBe('"first-time managers"');
    expect(normalForMatch("Don’t panic")).toBe("don't panic");
  });

  it("keeps a value that is in the material, whatever its case", () => {
    expect(groundedIn("First-time managers", "I help first-time managers delegate.")).toBe(true);
  });

  it("drops a value that is not in the material, and a blank one", () => {
    expect(groundedIn("Founders who scale", "I help first-time managers delegate.")).toBe(false);
    expect(groundedIn("   ", "anything")).toBe(false);
  });
});

describe("the cache basis covers what the pre-fill reads (M6)", () => {
  const f = { niche: "n", audience: "a", positioning: "p", offers: "o" };

  it("is stable for the same inputs", () => {
    const more = { stories: [{ title: "t", body: "b" }], proofs: [], strategy: [] };
    expect(basisFrom(3, f, more)).toBe(basisFrom(3, f, { ...more }));
  });

  it("changes when a story, a proof or a strategy answer changes", () => {
    const base = { stories: [{ title: "t", body: "b" }], proofs: [{ claim: "c" }], strategy: [{ key: "k", question: "q", answer: "x" }] };
    const before = basisFrom(3, f, base);
    expect(basisFrom(3, f, { ...base, stories: [{ title: "t", body: "changed" }] })).not.toBe(before);
    expect(basisFrom(3, f, { ...base, proofs: [{ claim: "new" }] })).not.toBe(before);
    expect(basisFrom(3, f, { ...base, strategy: [{ key: "k", question: "q", answer: "y" }] })).not.toBe(before);
  });
});

describe("suggestAnswers keeps only what the person's material supports (M6)", () => {
  it("saves the grounded answers and drops the invented ones; never-words are one-tap suggestions and pass through", async () => {
    st.answers = [
      { id: "A2", value: "first-time managers", evidence: "I help first-time managers" },
      { id: "A4", value: "Every leader should be a coach", evidence: "invented" },
      { id: "E1", value: "synergy, leverage", evidence: "never-words" },
    ];
    const out = await suggestAnswers(scope, packWith());
    expect(out.A2).toEqual({ value: "first-time managers", evidence: "I help first-time managers" });
    expect(out.A4).toBeUndefined();
    // Never-words are not facts (the writing cannot hold a word the person never uses), so they are not checked.
    expect(out.E1).toEqual({ value: ["synergy", "leverage"], evidence: "never-words" });
    expect((st.saved as { suggestions: { answers: unknown } }).suggestions.answers).toEqual(out);
  });
});
