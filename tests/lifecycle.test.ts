/**
 * The voice core over time (plan, Flow 4) and voice-note transcription.
 * Pure: no database, no network.
 */
import { describe, it, expect } from "vitest";
import { coreState, diffPacks, prefill, rescanDue, scanInProgress, SCAN_STALE_MS } from "@/lib/voice/lifecycle";
import { emptyIndex, tagged, type VoicePack } from "@/lib/voice/types";
import { openaiTranscriber } from "@/lib/ai/providers/openai-transcribe";
import { AiConfigError, ProviderError } from "@/lib/ai/errors";
import { MIN_PICKS, MAX_PICKS } from "@/lib/voice/words";
import { coreCardFacts } from "@/lib/voice/core-card";

function pack(over: Partial<VoicePack> = {}): VoicePack {
  return {
    id: "p1", userId: "u1", slug: "default", displayName: "Demo", status: "provisional", version: 1,
    voiceLine: "", hardRules: [], identity: {}, guardrails: [], mechanics: {}, contexts: {}, redPen: {},
    index: emptyIndex(), corpusStats: { pieces: 0, words: 0, sentences: 0, channels: [] }, scannedAt: null,
    onboarding: {}, workMode: "ghostwrite", topicSuggestions: [], topicsGeneratedAt: null,
    ...over,
  };
}
const NOW = Date.parse("2026-10-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const stats = (pieces: number) => ({ pieces, words: pieces * 100, sentences: pieces * 5, channels: ["linkedin"] });

describe("the four training states (§15.2)", () => {
  it("is Empty with no writing, Trained once there is some", () => {
    expect(coreState(pack(), NOW)).toBe("empty");
    expect(coreState(pack({ corpusStats: stats(3) }), NOW)).toBe("trained");
  });

  it("shows Ingesting and Learning while a scan runs, so a refresh still sees it", () => {
    expect(coreState(pack({ onboarding: { scan: { state: "ingesting", at: ago(5_000) } } }), NOW)).toBe("ingesting");
    expect(coreState(pack({ corpusStats: stats(3), onboarding: { scan: { state: "learning", at: ago(5_000) } } }), NOW)).toBe("learning");
  });

  it("treats a scan that never reported back as over", () => {
    expect(scanInProgress({ state: "learning", at: ago(SCAN_STALE_MS + 1) }, NOW)).toBeNull();
    expect(coreState(pack({ corpusStats: stats(3), onboarding: { scan: { state: "learning", at: ago(SCAN_STALE_MS + 1) } } }), NOW)).toBe("trained");
    expect(scanInProgress({ state: "done", at: ago(1) }, NOW)).toBeNull();
  });
});

describe("the 90-day re-measure invitation", () => {
  const scanned = (days: number) => pack({ corpusStats: stats(10), scannedAt: ago(days * 86_400_000) });

  it("invites after 90 days only when there is new writing to learn from", () => {
    expect(rescanDue(scanned(91), 2, NOW)).toEqual({ due: true, days: 91 });
    expect(rescanDue(scanned(91), 0, NOW).due).toBe(false);
    expect(rescanDue(scanned(30), 5, NOW).due).toBe(false);
  });

  it("never invites a pack that was never measured", () => {
    expect(rescanDue(pack({ scannedAt: null }), 9, NOW).due).toBe(false);
  });
});

describe("what a version changed", () => {
  it("says what moved, in the person's terms", () => {
    const before = pack({
      voiceLine: "An essayist.",
      index: { ...emptyIndex(), neverWords: ["synergy"] },
      identity: { dials: tagged({ casual_formal: 3 }, "ask"), reader: tagged("Founders", "ask") },
      guardrails: [{ id: "never-write", name: "Never written", rule: "No client names.", why: "", instead: "", source: "ask" }],
    });
    const after = pack({
      voiceLine: "An essayist who finds the big idea in a small moment.",
      index: { ...emptyIndex(), neverWords: ["leverage"] },
      identity: { dials: tagged({ casual_formal: 6 }, "ask"), reader: tagged("Founders", "ask") },
      guardrails: [],
    });
    const d = diffPacks(before, after);
    expect(d.some((x) => x.startsWith("Voice line:"))).toBe(true);
    expect(d).toContain("Never use: added “leverage”.");
    expect(d).toContain("Never use: removed “synergy”.");
    expect(d.some((x) => x.startsWith("Dial Casual") && x.endsWith("3 → 6."))).toBe(true);
    expect(d).toContain("Never written: cleared.");
    expect(d.some((x) => x.startsWith("Your reader"))).toBe(false);
  });

  it("is empty when nothing a person decides changed", () => {
    expect(diffPacks(pack(), pack())).toEqual([]);
  });
});

describe("one-tap confirms", () => {
  it("offers what the pack already has, then the brief, then nothing", () => {
    expect(prefill("A2", "A newly promoted manager", {})).toEqual({ value: "A newly promoted manager", from: "what we already have" });
    expect(prefill("A2", "", { audience: "First-time engineering managers" })?.from).toBe("your brief");
    expect(prefill("C1", "", { audience: "x" })).toBeNull();
    expect(prefill("E1", ["synergy"], {})?.value).toEqual(["synergy"]);
    expect(prefill("E1", [], {})).toBeNull();
  });
});

describe("the word picker follows the plan", () => {
  it("asks for 12 to 15 words", () => {
    expect([MIN_PICKS, MAX_PICKS]).toEqual([12, 15]);
  });
});

describe("voice-note transcription", () => {
  const cfg = { apiKey: "test-key", model: "test-transcribe", timeoutMs: 5_000 };
  const audio = new Blob(["fake audio"], { type: "audio/webm" });

  it("sends one multipart request and returns the text", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const t = openaiTranscriber(cfg, async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ text: "  I help new managers stop firefighting.  " }), { status: 200 });
    });
    const out = await t.transcribe(audio, "note.webm");
    expect(out).toEqual({ text: "I help new managers stop firefighting.", model: "test-transcribe" });
    expect(seen!.url).toMatch(/audio\/transcriptions$/);
    const body = seen!.init.body as FormData;
    expect(body.get("model")).toBe("test-transcribe");
    expect(body.get("file")).toBeInstanceOf(Blob);
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("turns failures into typed errors, never empty text", async () => {
    const reply = (status: number, body = "{}") => openaiTranscriber(cfg, async () => new Response(body, { status }));
    await expect(reply(401).transcribe(audio, "n.webm")).rejects.toMatchObject({ kind: "auth" });
    await expect(reply(429).transcribe(audio, "n.webm")).rejects.toMatchObject({ kind: "rate_limit", retryable: true });
    await expect(reply(500).transcribe(audio, "n.webm")).rejects.toMatchObject({ kind: "server" });
    await expect(reply(200, "{\"nope\":1}").transcribe(audio, "n.webm")).rejects.toBeInstanceOf(ProviderError);
    const dead = openaiTranscriber(cfg, async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); });
    await expect(dead.transcribe(audio, "n.webm")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("is off unless configured, and a half-configured provider is an error", async () => {
    const { selectTranscriber } = await import("@/lib/ai");
    const base = { AI_TEXT_TIMEOUT_MS: 1000 } as Parameters<typeof selectTranscriber>[0];
    expect(selectTranscriber({ ...base, AI_TRANSCRIBE_PROVIDER: "off" })).toBeNull();
    expect(() => selectTranscriber({ ...base, AI_TRANSCRIBE_PROVIDER: "openai", AI_TRANSCRIBE_MODEL: "m" })).toThrow(AiConfigError);
    expect(() => selectTranscriber({ ...base, AI_TRANSCRIBE_PROVIDER: "openai", OPENAI_API_KEY: "k" })).toThrow(AiConfigError);
    expect(selectTranscriber({ ...base, AI_TRANSCRIBE_PROVIDER: "openai", OPENAI_API_KEY: "k", AI_TRANSCRIBE_MODEL: "m" })).not.toBeNull();
  });
});

describe("the brand core card's facts (§15.1), shared by Brand home, Voice and Check", () => {
  it("says the same thing wherever the core is shown", () => {
    const p = pack({
      displayName: "Alex Rivera", version: 4, scannedAt: "2026-10-02T09:00:00Z",
      corpusStats: { pieces: 3, words: 1250, sentences: 40, channels: ["linkedin", "newsletter"] },
      identity: { toneDescriptors: tagged(["Direct", "Warm", "Contrarian", "Evidence-led", "Dry", "Sixth"], "ask") },
    });
    const f = coreCardFacts(p, NOW);
    expect(f.name).toBe("Alex Rivera");
    expect(f.subtitle).toBe("linkedin, newsletter · core v4 · measured 2 Oct");
    expect(f.attributes).toEqual(["Direct", "Warm", "Contrarian", "Evidence-led", "Dry"]);
    expect(f.stats).toEqual([
      { label: "Samples", value: "3" },
      { label: "Words read", value: "1.3k" },
      { label: "Channels", value: "2" },
    ]);
    expect(f.state).toBe("trained");
  });

  it("never rounds confidence up, and says what would raise it", () => {
    const f = coreCardFacts(pack({ corpusStats: stats(1) }), NOW);
    expect(f.confidence).toBeLessThan(70);
    expect(f.trained).toBe(false);
    expect(f.missing[0]).toMatch(/more pieces of your writing/);
  });

  it("falls back to a plain name and Empty before there is any writing", () => {
    const f = coreCardFacts(pack({ displayName: "" }), NOW);
    expect(f.name).toBe("Your voice");
    expect(f.state).toBe("empty");
    expect(f.subtitle).toBe("core v1");
  });
});
