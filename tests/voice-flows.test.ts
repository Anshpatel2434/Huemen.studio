/**
 * The pure pieces behind onboarding, Check and Train (build steps 4–8).
 * No database: every function here is (input) → output.
 */
import { describe, it, expect } from "vitest";
import { WORDS, FAMILIES, groupPicks } from "@/lib/voice/words";
import { QUESTIONS, isGeneric, nextDeepQuestions, questionById } from "@/lib/voice/questions";
import { applyAnswer, applyDials } from "@/lib/voice/answers";
import { benchmarkPicks, confidence, confirmCards, estimateDials, removedWords, scanChanges } from "@/lib/voice/derive";
import { ingestLinkedIn, ingestText, ingestWhatsApp, parseCsv, stripEmail } from "@/lib/voice/ingest";
import { TASKS, coWriteOutline, rewriteInVoice, topicProposals, voiceJudge } from "@/lib/ai/tasks";
import { measureCorpus } from "@/lib/voice/measure";
import { emptyIndex, tagged, type VoicePack, type VoiceSample } from "@/lib/voice/types";

function pack(over: Partial<VoicePack> = {}): VoicePack {
  return {
    id: "p1", userId: "u1", slug: "default", displayName: "Demo", status: "provisional", version: 1,
    voiceLine: "", hardRules: [], identity: {}, guardrails: [], mechanics: {}, contexts: {}, redPen: {},
    index: emptyIndex(), corpusStats: { pieces: 0, words: 0, sentences: 0, channels: [] }, scannedAt: null,
    onboarding: {}, workMode: "ghostwrite", topicSuggestions: [], topicsGeneratedAt: null,
    ...over,
  };
}

const sample = (id: string, body: string, over: Partial<VoiceSample> = {}): VoiceSample => ({
  id, channel: "linkedin", kind: "corpus", source: "paste", visibility: "public", body,
  wordCount: body.split(/\s+/).length, excluded: false, ...over,
});

describe("the personality words (C5, C6)", () => {
  it("has the spec's 80 words, each once", () => {
    expect(WORDS).toHaveLength(80);
    expect(new Set(WORDS.map(([w]) => w)).size).toBe(80);
    for (const [, f] of WORDS) expect(FAMILIES[f]).toBeDefined();
  });

  it("groups picks into at most four families, largest first", () => {
    const groups = groupPicks(["Bold", "Daring", "Fearless", "Warm", "Kind", "Clever", "Fun", "Calm", "Elegant"]);
    expect(groups.length).toBeLessThanOrEqual(4);
    expect(groups[0].words).toEqual(["Bold", "Daring", "Fearless"]);
  });
});

describe("the question bank", () => {
  it("holds every Core question the stepper asks", () => {
    for (const id of ["A2", "A3", "A4", "C1", "C2", "C4", "C5", "C6", "D1", "D2", "D7", "E1"]) {
      expect(questionById(id)?.tier).toBe("core");
    }
  });

  it("spots a generic answer the way file 05 defines it", () => {
    expect(isGeneric("Professional and approachable")).toBe(true);
    expect(isGeneric("A new manager at a 200-person startup, reading me on the train after their first bad one-to-one")).toBe(false);
  });

  it("drips Deep questions only after approved pieces, a few at a time", () => {
    expect(nextDeepQuestions([], 4)).toEqual([]);
    expect(nextDeepQuestions([], 5)).toHaveLength(3);
    const first = nextDeepQuestions([], 5).map((q) => q.id);
    expect(nextDeepQuestions(first, 5)).toEqual([]); // that batch is spent
    expect(nextDeepQuestions(first, 10)).toHaveLength(3);
    expect(QUESTIONS.every((q) => q.ask.length > 10)).toBe(true);
  });
});

describe("where answers go", () => {
  it("writes the reader, roles and the one idea into identity", () => {
    expect(applyAnswer(pack(), "A2", "A new manager on a Tuesday").patch.identity?.reader?.value).toBe("A new manager on a Tuesday");
    expect(applyAnswer(pack(), "A3", "A mentor: I've been where they are").patch.identity?.personaRoles?.value).toEqual(["A mentor: I've been where they are"]);
  });

  it("adds never-words to both the red pen and the check index, without duplicates", () => {
    const p = pack({ index: { ...emptyIndex(), neverWords: ["synergy"] } });
    const out = applyAnswer(p, "E1", ["Synergy", "hustle", "guru"]).patch;
    expect(out.index?.neverWords).toEqual(["synergy", "hustle", "guru"]);
    expect(out.redPen?.neverList?.value).toEqual(["synergy", "hustle", "guru"]);
  });

  it("makes a line they'd never cross a guardrail (claimed beats observed)", () => {
    const g = applyAnswer(pack(), "D1", "I'd never call myself a thought leader").patch.guardrails!;
    expect(g[0]).toMatchObject({ name: "Self-labelling", rule: "I'd never call myself a thought leader", source: "ask" });
  });

  it("never overwrites a measured lexicon with typed words (observed beats claimed)", () => {
    const p = pack({ mechanics: { lexicon: tagged(["clarity"], "scan", "measured", { count: 9 }) } });
    const lex = applyAnswer(p, "E2", "attention, ownership").patch.mechanics?.lexicon;
    expect(lex?.confidence).toBe("measured");
    expect(lex?.value).toEqual(["clarity", "attention", "ownership"]);
  });

  it("keeps a long party answer as a spoken sample", () => {
    const long = "I'd be the one asking people what they actually do all day, then telling a story about the worst client brief I ever got, and laughing at myself first.";
    expect(applyAnswer(pack(), "C1", long).spokenSample).toBe(long);
    expect(applyAnswer(pack(), "C1", "Quiet.").spokenSample).toBeUndefined();
  });

  it("keeps the scan's dial estimate beside the person's choice", () => {
    const out = applyDials(pack(), { casual_formal: 2 }, { casual_formal: 7 });
    expect(out.identity?.dials?.value).toEqual({ casual_formal: 2 });
    expect(out.identity?.dials?.measuredValue).toEqual({ casual_formal: 7 });
  });
});

describe("derived from the pack", () => {
  it("scores an empty core low and never calls it trained", () => {
    const c = confidence(pack());
    expect(c.score).toBeLessThan(20);
    expect(c.trained).toBe(false);
    expect(c.missing[0]).toMatch(/Add 10 more pieces/);
  });

  it("cannot reach 70 on answers alone; writing has to prove the voice", () => {
    const answered = pack({
      status: "active", scannedAt: "2026-10-01",
      guardrails: [{ id: "g", name: "x", rule: "y", why: "", instead: "", source: "ask" }],
      identity: {
        personalityWords: tagged([{ word: "A", meaning: "" }, { word: "B", meaning: "" }, { word: "C", meaning: "" }, { word: "D", meaning: "" }], "ask"),
        dials: tagged({ fun_serious: 5, casual_formal: 5, cheeky_respectful: 5, youthful_mature: 5 }, "ask"),
        feeling30s: tagged("sharp", "ask"),
      },
      corpusStats: { pieces: 3, words: 200, sentences: 20, channels: ["linkedin"] },
    });
    expect(confidence(answered).score).toBeLessThan(70);
    expect(confidence(answered).trained).toBe(false);
  });

  it("estimates only the dials the measurements speak to", () => {
    const m = measureCorpus([{ id: "a", body: "It's fine! I'm happy! We're done." }, { id: "b", body: "Don't worry! It's great!" }]);
    const d = estimateDials(pack({ mechanics: m.mechanics }));
    expect(Object.keys(d).sort()).toEqual(["casual_formal", "enthusiastic_practical", "fun_serious"]);
    expect(d.enthusiastic_practical!).toBeLessThan(5);
  });

  it("raises H5 when a never-word is in their own writing, and stops once resolved", () => {
    const p = pack({ index: { ...emptyIndex(), neverWords: ["leverage"] } });
    const s = [sample("a", "We leverage our network every week."), sample("b", "Leverage is underrated.")];
    expect(confirmCards(p, s).find((c) => c.kind === "H5")?.title).toContain("2 of your pieces");
    expect(confirmCards({ ...p, onboarding: { resolvedCards: ["H5:leverage"] } }, s).find((c) => c.kind === "H5")).toBeUndefined();
  });

  it("raises H1 when a dial moved three points away from the writing", () => {
    const p = pack({ identity: { dials: { ...tagged({ casual_formal: 2 }, "ask"), measuredValue: { casual_formal: 7 } } } });
    expect(confirmCards(p, []).find((c) => c.id === "H1:casual_formal")).toBeDefined();
  });

  it("shows a line once in H4 when a short piece opens and closes on it", () => {
    const ex = (example: string) => ({ pattern: "statement", example, count: 1 });
    const p = pack({
      mechanics: {
        openers: tagged([ex("Same line."), ex("Only an opener.")], "scan"),
        closers: tagged([ex("Same line."), ex("Only a closer.")], "scan"),
      },
    });
    const items = confirmCards(p, []).find((c) => c.kind === "H4")!.items!;
    expect(items.map((i) => i.text)).toEqual(["Same line.", "Only an opener.", "Only a closer."]);
    expect(items[0].id).toBe("o0,c0");
  });

  it("raises H3 for pieces flagged as unlike the rest", () => {
    const cards = confirmCards(pack(), [sample("a", "Odd one.", { suspectReason: "far more em dashes" })]);
    expect(cards[0].kind).toBe("H3");
  });

  it("picks benchmarks from public writing only", () => {
    const pieces = Array.from({ length: 10 }, (_, i) =>
      sample(`p${i}`, `Piece ${i}. ${"A typical sentence about the work. ".repeat(4 + (i % 3))}`),
    );
    const priv = sample("x", "Private email to a client about the Q3 number and the deal closing Friday.", { visibility: "private" });
    const picks = benchmarkPicks([...pieces, priv]);
    expect(picks.length).toBeGreaterThanOrEqual(6);
    expect(picks.map((p) => p.id)).not.toContain("x");
  });

  it("finds the words an edit removed, not the ones it moved", () => {
    // "should" is a stopword: deleting it says nothing about a voice.
    expect(removedWords("We should unpack this together today", "Let's look at this together today")).toEqual(["unpack"]);
    expect(removedWords("Unpack it. Unpack it again.", "It again, unpack it.")).toEqual([]);
  });

  it("reports what a re-scan changed, and nothing when nothing did", () => {
    const before = { mechanics: {}, corpusStats: { pieces: 10, words: 3100, sentences: 200, channels: [] } };
    const after = { mechanics: {}, corpusStats: { pieces: 20, words: 4400, sentences: 300, channels: [] } };
    expect(scanChanges(before, after)).toEqual(["Pieces measured: 10 → 20.", "Your pieces got shorter: about 310 → 220 words."]);
    expect(scanChanges(before, before)).toEqual([]);
  });
});

describe("ingesting exports (step 1)", () => {
  it("parses quoted CSV with commas and newlines inside a field", () => {
    expect(parseCsv('a,b\n"one, two","line1\nline2"\n')).toEqual([["a", "b"], ["one, two", "line1\nline2"]]);
  });

  it("reads LinkedIn posts and skips reshares with nothing of their own", () => {
    const csv = 'Date,ShareLink,ShareCommentary,SharedUrl\n2026-03-01 09:00:00,https://x,"First line.\n\nSecond, with a comma.",\n2026-03-02 09:00:00,https://y,"",https://z\n';
    const r = ingestLinkedIn(csv);
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0]).toMatchObject({ channel: "linkedin", visibility: "public", publishedAt: "2026-03-01" });
    expect(r.pieces[0].body).toContain("Second, with a comma.");
    expect(r.summary).toContain("1 skipped");
  });

  it("reads LinkedIn comments as the unguarded voice", () => {
    const r = ingestLinkedIn("Date,Link,Message\n2026-03-01,https://x,Totally agree with this.\n");
    expect(r.pieces[0]).toMatchObject({ channel: "linkedin_comment", kind: "unguarded" });
  });

  it("keeps only the person's own WhatsApp messages and stores nobody else's", () => {
    const chat = [
      "12/03/2024, 21:15 - Asha: Are we still on for Friday?",
      "12/03/2024, 21:16 - Demo: Yes. I'll bring the deck.",
      "It's the short version this time.",
      "12/03/2024, 21:17 - Asha: Great, the client said 41 lakh is fine",
      "12/03/2024, 21:18 - Demo: <Media omitted>",
      "13/03/2024, 08:02 - Demo: Running ten minutes late.",
    ].join("\n");
    const r = ingestWhatsApp(chat, "Demo");
    const all = r.pieces.map((p) => p.body).join(" ");
    expect(all).toContain("I'll bring the deck.\nIt's the short version this time.");
    expect(all).not.toContain("41 lakh");
    expect(all).not.toContain("Media omitted");
    expect(r.pieces).toHaveLength(2); // grouped by day
    expect(r.pieces.every((p) => p.visibility === "private")).toBe(true);
    expect(r.summary).toContain("2 messages from other people were left out");
  });

  it("strips quoted replies and signatures from a sent email", () => {
    const email = "Hi Sam,\n\nThanks, I'll send it Friday.\n\nBest,\nDemo\n-- \nDemo Ltd | +44 ...\n\nOn Tue, Sam wrote:\n> the old thread";
    const out = stripEmail(email);
    expect(out).toContain("I'll send it Friday.");
    expect(out).not.toContain("Demo Ltd");
    expect(out).not.toContain("old thread");
  });

  it("treats a text file as one piece unless it separates pieces with ---", () => {
    expect(ingestText("A post.\n\nWith two paragraphs.", "newsletter", "public").pieces).toHaveLength(1);
    expect(ingestText("Post one.\n---\nPost two.", "linkedin", "public").pieces).toHaveLength(2);
  });
});

describe("model tasks run end to end on the stand-in", () => {
  it("registers every task, and every stand-in answer passes its own schema", () => {
    for (const task of [topicProposals, voiceJudge, rewriteInVoice, coWriteOutline]) {
      expect(TASKS[task.key]).toBe(task);
    }
    const input = "Pillar: Delegation\nPillar: Hiring\nNever use: leverage\n\nDraft:\nWe leverage the team.\nShort line.";
    expect(topicProposals.schema.parse(topicProposals.mock(input)).topics).toHaveLength(3);
    const judged = voiceJudge.schema.parse(voiceJudge.mock(input));
    expect(judged.findings[0]).toMatchObject({ line: "We leverage the team.", verdict: "off", attribute: "Never-list" });
    expect(rewriteInVoice.mock(input).text).toBe("We the team.\nShort line.");
    expect(rewriteInVoice.mock("Draft:\nIn today's fast-paced world, let's dive in! We ship!!!").text).toBe("We ship.");
    expect(coWriteOutline.schema.parse(coWriteOutline.mock("Topic: delegation")).points.length).toBeGreaterThan(2);
  });
});
