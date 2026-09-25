/**
 * The measurement engine and the deterministic voice check (client spec,
 * files 01 §5 and 06 §4). Pure functions, so no database is needed.
 *
 * The corpora below are written to be opposites on purpose. The spec's whole
 * argument is that Richa's ellipsis and Rohan's ban on it are BOTH signatures,
 * and that a one-size anti-AI rule would be wrong for both. If this engine
 * can't tell them apart, nothing downstream works.
 */
import { describe, it, expect } from "vitest";
import { measureCorpus, measurePiece, splitSentences, words } from "@/lib/voice/measure";
import { bandFor, checkDraft } from "@/lib/voice/check";
import { EMPTY_INDEX } from "@/lib/voice/types";

/** Ellipses everywhere, fragments, ends on a question. */
const RICHA = [
  "I watched a board spend two hours on a logo.\n\nTwo hours.\n\nNot once did anyone ask who the thing was for… which is the only question that mattered.\n\nWhat would you have asked?",
  "A director told me she had no time to think.\n\nShe had seven hours of meetings that day… and a strategy due on Friday.\n\nThinking isn't a luxury. It's the job.\n\nWhere does your thinking time actually live?",
  "Most brand problems are not brand problems.\n\nThey are clarity problems… dressed up in nicer fonts.\n\nClarity first. Always.\n\nWhat are you calling a brand problem this week?",
  "She said the restructure was about efficiency.\n\nIt wasn't… it was about avoiding one difficult conversation.\n\nEfficiency is often a story we tell.\n\nWhich conversation are you avoiding?",
  "Every team I've turned around had the same thing missing.\n\nNot talent. Not budget… attention.\n\nAttention is the scarce one.\n\nWhere is yours going today?",
];

/** Periods and commas only, closes with a next step, never a question. */
const ROHAN = [
  "We shipped the migration on Tuesday. It took four weeks, not six. The difference was cutting the reporting layer entirely. I will send the numbers on Friday.",
  "The vendor call was a waste of an hour. They could not answer the pricing question. We are going with the other option. Book thirty minutes with me before you sign.",
  "Three people asked about the roadmap today. The roadmap has not changed since March. Read the doc, then bring me the part you disagree with.",
  "I reviewed the deck this morning. Slides four through nine say the same thing. Cut to one slide and send it back to me by noon.",
  "Hiring is slower than planned. We have two strong candidates and no third. Push the start date rather than lowering the bar. Let me know by Thursday.",
];

const corpus = (bodies: string[], channel = "linkedin") =>
  bodies.map((body, i) => ({ id: `s${i}`, channel, body }));

describe("splitting", () => {
  it("does not treat a mid-sentence ellipsis as a full stop", () => {
    expect(splitSentences("It wasn't… it was about avoiding one conversation.")).toHaveLength(1);
  });

  it("does treat an ellipsis before a capital as a full stop", () => {
    expect(splitSentences("Not talent… Attention is the scarce one.")).toHaveLength(2);
  });

  it("counts words without punctuation", () => {
    expect(words("Two hours. Not once.")).toEqual(["Two", "hours", "Not", "once"]);
  });
});

describe("measurePiece", () => {
  it("counts the marks that make up a fingerprint", () => {
    const m = measurePiece("Well… that's one way. Is it the right one? Maybe not!");
    expect(m.punctuation.ellipsis).toBe(1);
    expect(m.punctuation.question).toBe(1);
    expect(m.punctuation.exclamation).toBe(1);
    expect(m.punctuation.emDash).toBe(0);
  });

  it("reports contractions as a rate of the chances taken, not a raw count", () => {
    const m = measurePiece("It's late and I'm tired. It is not a problem.");
    expect(m.contractionsUsed).toBe(2);
    expect(m.contractionOpportunities).toBe(3);
  });

  it("sees a closing question", () => {
    expect(measurePiece("So. What would you have asked?").endsWithQuestion).toBe(true);
    expect(measurePiece("Send it back to me by noon.").endsWithQuestion).toBe(false);
  });
});

describe("measureCorpus", () => {
  it("measures the corpus rather than estimating it", () => {
    const r = measureCorpus(corpus(RICHA));
    expect(r.stats.pieces).toBe(5);
    expect(r.stats.sentences).toBeGreaterThan(15);
    expect(r.mechanics.sentences?.confidence).toBe("measured");
    expect(r.mechanics.sentences?.count).toBe(5);
  });

  it("carries evidence behind a trait, per the spec's rule", () => {
    const r = measureCorpus(corpus(RICHA));
    const ev = r.mechanics.punctuation?.evidence ?? [];
    expect(ev.length).toBeGreaterThan(0);
    expect(ev[0].quote).toMatch(/…/);
    expect(ev[0].sampleId).toBeDefined();
  });

  it("tells the two voices apart on their signature mark", () => {
    const richa = measureCorpus(corpus(RICHA));
    const rohan = measureCorpus(corpus(ROHAN));
    expect(richa.index.punctuation.ellipsis?.allowed).toBe(true);
    expect(rohan.index.punctuation.ellipsis?.allowed).toBe(false);
  });

  it("derives a closing question as a must-have only for the person who does it", () => {
    expect(measureCorpus(corpus(RICHA)).index.mustHaves).toContain("closing_question");
    expect(measureCorpus(corpus(ROHAN)).index.mustHaves).not.toContain("closing_question");
  });

  it("finds repeated phrases as signature candidates", () => {
    const r = measureCorpus(corpus([
      "Clarity is sustainability. That is the whole point.",
      "I keep saying it. Clarity is sustainability.",
      "Clarity is sustainability, and nobody wants to hear it.",
    ]));
    expect(r.signatureCandidates.map((s) => s.phrase)).toContain("clarity is sustainability");
  });

  it("flags a piece that reads unlike the rest instead of deleting it", () => {
    const planted = "In today's fast-paced world — and it is fast — we must delve — deeply — into synergy — always.";
    const r = measureCorpus(corpus([...ROHAN, planted]));
    expect(r.suspected).toHaveLength(1);
    expect(r.suspected[0].id).toBe("s5");
  });

  it("counts a private piece but never quotes it", () => {
    const r = measureCorpus([
      ...corpus(ROHAN),
      { id: "priv", channel: "email", private: true,
        body: "Hi Sam, the Q3 number is 41 lakh and the deal closes Friday." },
    ]);
    // Measured: it is part of how this person writes.
    expect(r.stats.pieces).toBe(6);
    // Never quoted: no opener, closer, phrase, lexicon entry or evidence quote.
    const verbatim = JSON.stringify(r.mechanics) + JSON.stringify(r.signatureCandidates);
    expect(verbatim).not.toContain("41 lakh");
    expect(verbatim).not.toContain("Hi Sam");
  });

  it("counts pieces per channel so a context can be tagged measured", () => {
    const r = measureCorpus([...corpus(RICHA, "linkedin"), ...corpus(ROHAN, "email")]);
    expect(r.piecesByChannel).toEqual({ linkedin: 5, email: 5 });
  });

  it("returns empty measurements rather than throwing on an empty corpus", () => {
    const r = measureCorpus([]);
    expect(r.stats.pieces).toBe(0);
    expect(r.mechanics).toEqual({});
  });
});

describe("checkDraft", () => {
  const richaIndex = measureCorpus(corpus(RICHA)).index;
  const rohanIndex = measureCorpus(corpus(ROHAN)).index;

  it("allows for one person the habit it flags for another", () => {
    const draft = "She said it was about efficiency… it wasn't.";
    const forRicha = checkDraft(draft, richaIndex);
    const forRohan = checkDraft(draft, rohanIndex);
    expect(forRicha.issues.map((i) => i.code)).not.toContain("punctuation_unused");
    expect(forRohan.issues.map((i) => i.code)).toContain("punctuation_unused");
  });

  it("catches a word on the personal never-list", () => {
    const r = checkDraft("We should leverage the team's strengths.", {
      ...EMPTY_INDEX,
      neverWords: ["leverage"],
    });
    expect(r.issues[0].code).toBe("never_word");
    expect(r.issues[0].severity).toBe("error");
    expect(r.issues[0].excerpt).toContain("leverage");
  });

  it("flags a watch-list phrase by citing their corpus, never by calling it AI", () => {
    const r = checkDraft("Let's dive in and see what we find.", EMPTY_INDEX, {
      corpusPieces: 11,
      corpusUses: { "let's dive in": 0 },
    });
    const found = r.issues.find((i) => i.code === "watch_phrase")!;
    expect(found).toBeDefined();
    // Design system §16: the interface never tells someone they sound like AI.
    expect(found.message).toMatch(/0 times in 11 pieces/);
    expect(r.issues.map((i) => i.message).join(" ")).not.toMatch(/AI|machine|robot/i);
  });

  it("stops flagging a watch-list phrase once it is a proven exception", () => {
    const r = checkDraft("Let's dive in and see what we find.", {
      ...EMPTY_INDEX,
      allowedExceptions: ["let's dive in"],
    });
    expect(r.issues.map((i) => i.code)).not.toContain("watch_phrase");
  });

  it("puts a score in the right band, and never blocks publishing", () => {
    expect(checkDraft("Send the numbers on Friday.", EMPTY_INDEX).band).toBe("on_brand");
    expect(bandFor(90)).toBe("on_brand");
    expect(bandFor(74)).toBe("drifting");
    expect(bandFor(38)).toBe("off_brand");
  });

  it("enforces the platform's hard limit", () => {
    const r = checkDraft("x".repeat(400), EMPTY_INDEX, { channel: "x" });
    const issue = r.issues.find((i) => i.code === "platform_limit");
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toContain("280");
  });

  it("rations signature phrases to one a piece", () => {
    const r = checkDraft("Clarity is sustainability, and attention is the scarce one.", {
      ...EMPTY_INDEX,
      signaturePhrases: ["clarity is sustainability", "attention is the scarce one"],
    });
    expect(r.issues.map((i) => i.code)).toContain("signature_overuse");
  });

  it("notices the same opening as a recent piece", () => {
    const r = checkDraft("I watched a board spend two hours on a logo.", EMPTY_INDEX, {
      recentOpeners: ["I watched a board waste an afternoon."],
    });
    expect(r.issues.map((i) => i.code)).toContain("repeat_opener");
  });

  it("scores a clean draft high and a bad one low, and never blocks", () => {
    const clean = checkDraft("Send the numbers on Friday.", rohanIndex);
    const bad = checkDraft(
      "Let's dive in — we must leverage synergy — in today's fast-paced world!!!",
      { ...rohanIndex, neverWords: ["leverage", "synergy"] },
    );
    expect(clean.score).toBeGreaterThan(bad.score);
    expect(bad.score).toBeGreaterThanOrEqual(0);
    expect(bad.issues.length).toBeGreaterThan(3);
  });
});
