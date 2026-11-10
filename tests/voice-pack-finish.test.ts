/**
 * Voice Pack v2, the last pieces: the eight-file export, the "ready to write"
 * checklist, the drafted voice line, Word documents, and the WhatsApp cap.
 */
import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { emptyIndex, tagged, type VoicePack, type VoiceSample } from "@/lib/voice/types";
import { exportVoiceFile, exportVoicePack, VOICE_FILES } from "@/lib/voice/export";
import { readyChecklist, suggestVoiceLine } from "@/lib/voice/derive";
import { docxText } from "@/lib/voice/documents";
import { ingestWhatsApp, WA_MAX_DAYS } from "@/lib/voice/ingest";

function pack(over: Partial<VoicePack> = {}): VoicePack {
  return {
    id: "p1", userId: "u1", slug: "riya", displayName: "Riya", status: "active", version: 3,
    voiceLine: "", hardRules: [],
    identity: {}, guardrails: [], mechanics: {}, contexts: {}, redPen: {}, index: emptyIndex(),
    corpusStats: { pieces: 0, words: 0, sentences: 0, channels: [] }, scannedAt: null,
    onboarding: {}, workMode: "ghostwrite", topicSuggestions: [], topicsGeneratedAt: null,
    ...over,
  };
}

const sample = (id: string, body: string, over: Partial<VoiceSample> = {}): VoiceSample => ({
  id, channel: "linkedin", kind: "corpus", source: "paste", visibility: "public", body, wordCount: body.split(/\s+/).length, excluded: false, ...over,
});

describe("the Voice Pack downloads as the spec's eight files (01 §2)", () => {
  const p = pack({
    voiceLine: "Says the useful thing plainly.",
    guardrails: [{ id: "self-label", name: "Never claim a title", rule: "Never call herself an expert.", why: "Let the reader decide.", instead: "Show the work.", source: "ask" }],
    index: { ...emptyIndex(), neverWords: ["synergy"] },
    onboarding: { benchmarkNotes: { b1: { note: "Short, blunt, a reframe.", confirmed: true } } },
  });
  const samples = [
    sample("b1", "Your first salary is a test.", { kind: "benchmark" }),
    sample("c1", "Public post body here."),
    sample("m1", "PRIVATE email to my accountant about the loan.", { visibility: "private", channel: "email" }),
  ];

  it("writes every file, and the whole pack holds all eight", () => {
    for (const f of VOICE_FILES) expect(exportVoiceFile(f, p, samples).length).toBeGreaterThan(20);
    const all = exportVoicePack(p, samples);
    for (const f of VOICE_FILES) expect(all).toContain(`<!-- ${f} -->`);
  });

  it("VOICE.md holds the line and three hard rules, the facts rule always one of them", () => {
    const v = exportVoiceFile("VOICE.md", p, samples);
    expect(v).toContain("Says the useful thing plainly.");
    expect(v).toMatch(/3\. Never invent a fact/);
  });

  it("counts private writing but never includes it", () => {
    const s = exportVoiceFile("samples.md", p, samples);
    expect(s).toContain("Your first salary is a test.");
    expect(s).toContain("Short, blunt, a reframe.");
    expect(s).toContain("1 private pieces measured but not included");
    expect(exportVoicePack(p, samples)).not.toContain("PRIVATE email");
  });

  it("voice.json is valid JSON with the index", () => {
    const j = JSON.parse(exportVoiceFile("voice.json", p, samples));
    expect(j.never_words).toEqual(["synergy"]);
    expect(j.signature_phrase_max_per_piece).toBeDefined();
  });
});

describe("ready to write (06, Definition of Done)", () => {
  it("names what's missing, and fills in as the pack grows", () => {
    const empty = readyChecklist(pack(), 10);
    expect(empty.every((r) => !r.done)).toBe(true);
    const full = readyChecklist(pack({
      voiceLine: "x", corpusStats: { pieces: 12, words: 3000, sentences: 200, channels: ["linkedin"] },
      guardrails: [{ id: "g", name: "g", rule: "r", why: "", instead: "", source: "ask" }],
      index: { ...emptyIndex(), neverWords: ["synergy"] },
      contexts: { linkedin: { channel: "linkedin", tag: "measured", pieceCount: 6 } },
      onboarding: { answered: ["G2"], benchmarkNotes: { b1: { note: "n", confirmed: true } }, antiSample: { text: "t", off: "o" } },
    }), 10);
    expect(full.every((r) => r.done)).toBe(true);
  });
});

describe("a drafted voice line", () => {
  it("comes from their role, words and one idea", () => {
    const line = suggestVoiceLine(pack({ identity: {
      personaRoles: tagged(["Older sibling"], "ask"),
      personalityWords: tagged([{ word: "Blunt", meaning: "" }, { word: "Warm", meaning: "" }], "ask"),
      carries: tagged("Money is a skill, not a talent.", "ask"),
    } }));
    expect(line).toBe("An older sibling, blunt and warm, who keeps coming back to one idea: money is a skill, not a talent.");
  });
  it("is empty when there's nothing to draft from", () => {
    expect(suggestVoiceLine(pack())).toBe("");
  });
});

describe("Word documents", () => {
  it("keeps paragraphs and drops tracked deletions", () => {
    const xml = `<?xml version="1.0"?><w:document><w:body>
      <w:p><w:r><w:t>First line &amp; more.</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">Second </w:t></w:r><w:del><w:r><w:t>removed</w:t></w:r></w:del><w:r><w:t>para.</w:t></w:r></w:p>
    </w:body></w:document>`;
    const bytes = zipSync({ "word/document.xml": strToU8(xml), "[Content_Types].xml": strToU8("<Types/>") });
    expect(docxText(bytes)).toBe("First line & more.\nSecond para.");
  });
});

describe("WhatsApp keeps the newest days", () => {
  it(`keeps the last ${WA_MAX_DAYS} days and says how many were left out`, () => {
    const lines: string[] = [];
    for (let d = 0; d < WA_MAX_DAYS + 5; d++) {
      const day = new Date(Date.UTC(2026, 0, 1 + d));
      const date = `${String(day.getUTCDate()).padStart(2, "0")}/${String(day.getUTCMonth() + 1).padStart(2, "0")}/2026`;
      lines.push(`${date}, 10:00 - Riya: message on day ${d}`);
    }
    const r = ingestWhatsApp(lines.join("\n"), "Riya");
    expect(r.pieces).toHaveLength(WA_MAX_DAYS);
    expect(r.pieces[0].body).toBe("message on day 5");
    expect(r.summary).toContain("5 older days left out");
  });
});
