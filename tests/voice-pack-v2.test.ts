/**
 * Voice Pack v2 gap closing (spec files 01, 05, 06, 07). Pure tests: no DB.
 */
import { describe, expect, it } from "vitest";
import { buildBrandContext, type VoicePackInput } from "@/lib/context/context-builder";
import { packToContextInput } from "@/lib/voice/context";
import { applyUserEdits, emptyIndex, tagged, withUserEdits, type Mechanics, type VoicePack } from "@/lib/voice/types";
import { splitPieces, stripEmail } from "@/lib/voice/ingest";
import { cleanForMeasure, measureCorpus, CHANNEL_BALANCE_CAP } from "@/lib/voice/measure";
import { checkDraft, copiedRun } from "@/lib/voice/check";
import { sampleEvery, sentMailPage, GMAIL_KEEP } from "@/lib/integrations/google";
import type { FetchLike } from "@/lib/integrations/oauth";

function pack(over: Partial<VoicePack> = {}): VoicePack {
  return {
    id: "p1", userId: "u1", slug: "riya", displayName: "Riya", status: "active", version: 3,
    voiceLine: "Says the useful thing plainly.", hardRules: ["Never invent a number."],
    identity: {}, guardrails: [], mechanics: {}, contexts: {}, redPen: {}, index: emptyIndex(),
    corpusStats: { pieces: 0, words: 0, sentences: 0, channels: [] }, scannedAt: null,
    onboarding: {}, workMode: "ghostwrite", topicSuggestions: [], topicsGeneratedAt: null,
    ...over,
  };
}

describe("everything the person told us reaches the prompt (01 §3)", () => {
  const p = pack({
    identity: {
      guarded: tagged("Measured, asks questions, listens more than talks.", "ask"),
      unguarded: tagged("Dry jokes about bad budgets, a bit cheeky.", "ask"),
      dials: { ...tagged({ fun_serious: 3, casual_formal: 8 }, "ask"), confidence: "aspiration" },
      personaRoles: tagged(["A peer: we're at the same level, trading notes"], "ask"),
      roots: tagged("Grew up watching my father run a shop on thin margins.", "ask"),
      feeling30s: tagged("This person sees what others miss.", "ask"),
      answers: { "F3 · Someone complains or is upset": "I drop the jokes and own it fast.", "F5 · Emails": "Best, Riya", A6: "People say I'm blunt but kind." },
    },
    redPen: {
      mustHaves: tagged(["closing_question"], "scan"),
      selfCheck: tagged(["Could anyone else have written this line?"], "edit"),
      exceptions: tagged([{ item: "Ellipsis allowed", evidence: "about 1.6 a piece" }], "scan"),
    },
    onboarding: {
      antiSample: { text: "Unlock your financial potential today!", off: "Salesy, not her", fixed: "Start with one number." },
      benchmarkNotes: { s1: { note: "Short, blunt, a reframe.", confirmed: true } },
    },
  });
  const vp = packToContextInput(p, [{ id: "s1", channel: "linkedin", kind: "benchmark", source: "paste", visibility: "public", body: "Your first salary is a test.", wordCount: 6, excluded: false }]);
  const write = buildBrandContext({ voicePack: vp, task: "write" }).serialized;

  it("carries the party answers, dials, persona, roots, feelings, tone shifts and sign-offs", () => {
    expect(write).toContain("In public, sober: Measured, asks questions");
    expect(write).toContain("Guard down: Dry jokes about bad budgets");
    expect(write).toContain("Fun–Serious 3 (leans fun)");
    expect(write).toContain("Casual–Formal 8 (leans formal)");
    expect(write).toContain("where they want to sound, not where their old writing sits");
    expect(write).toContain("To their reader they are: A peer");
    expect(write).toContain("Where the voice comes from: Grew up watching my father");
    expect(write).toContain("After a 30-second skim: This person sees what others miss.");
    expect(write).toContain("Someone complains or is upset: I drop the jokes and own it fast.");
    expect(write).toContain('Emails: "Best, Riya"');
    expect(write).toContain("What people say about how they write: People say I'm blunt but kind.");
  });

  it("carries the red pen, benchmark notes and the anti-sample, in readable words", () => {
    expect(write).toContain("Every piece has: a closing question");
    expect(write).not.toContain("closing_question");
    expect(write).toContain("Could anyone else have written this line?");
    expect(write).toContain("Ellipsis allowed (about 1.6 a piece)");
    expect(write).toContain("Why this is them: Short, blunt, a reframe.");
    expect(write).toContain('Almost them, but wrong: "Unlock your financial potential today!"');
  });

  it("loads per task, in the spec's order", () => {
    const at = (s: string, x: string) => s.indexOf(x);
    // write: VOICE → guardrails → mechanics → platform → contexts → samples → identity
    expect(at(write, "Hard rules")).toBeLessThan(at(write, "Their real writing"));
    expect(at(write, "Their real writing")).toBeLessThan(at(write, "In public, sober"));

    const check = buildBrandContext({ voicePack: vp, task: "check" }).serialized;
    expect(check).toContain("Every piece has: a closing question");
    expect(check).not.toContain("Their real writing");
    expect(check).not.toContain("In public, sober");
    // The check knows where they're heading, so a move toward it isn't drift.
    expect(check).toContain("Where they're heading");
    expect(check).toContain("Fun–Serious 3");
    expect(write).not.toContain("Where they're heading");

    const rewrite = buildBrandContext({ voicePack: vp, task: "rewrite" }).serialized;
    expect(rewrite).toContain("Their real writing");
    expect(rewrite).not.toContain("In public, sober");

    const reply = buildBrandContext({ voicePack: { ...vp, context: { channel: "whatsapp", tag: "inferred", lines: [] } }, task: "reply" }).serialized;
    expect(reply).toContain("How they write on whatsapp");
    expect(reply).not.toContain("Their real writing");
    expect(reply).not.toContain("Measured fingerprint");
  });

  it("puts platform hard limits above the guardrails (07 precedence)", () => {
    const s = buildBrandContext({ voicePack: { ...vp } as VoicePackInput, platform: { label: "X", lines: ["At most 280 characters in total."] } }).serialized;
    expect(s).toContain("Its hard limits beat every other instruction, the guardrails included");
  });
});

describe("a re-scan keeps what the person changed by hand (01 §6)", () => {
  it("keeps dropped openers dropped, their own opener first, and their lexicon edits", () => {
    const edited = withUserEdits({}, { droppedPatterns: ["Tired opener."], addedOpeners: ["My own first line."], addedLexicon: ["clarity"], droppedLexicon: ["synergy"] });
    const fresh: Mechanics = {
      openers: tagged([{ pattern: "Opens with a statement", example: "Tired opener." }, { pattern: "Opens with a question", example: "Why save?" }], "scan", "measured"),
      closers: tagged([{ pattern: "Ends on a statement", example: "Tired opener." }], "scan", "measured"),
      lexicon: tagged(["synergy", "budget"], "scan", "measured"),
    };
    const out = applyUserEdits(fresh, edited.userEdits);
    expect(out.openers!.value.map((o) => o.example)).toEqual(["My own first line.", "Why save?"]);
    expect(out.closers!.value).toEqual([]);
    expect(out.lexicon!.value).toEqual(["clarity", "budget"]);
    expect(out.userEdits).toEqual(edited.userEdits);
  });
});

describe("the clean step and splitting (06 §3–4)", () => {
  it("never splits a post on a single blank line; --- or two blank lines separate pieces", () => {
    expect(splitPieces("Para one.\n\nPara two.")).toEqual(["Para one.\n\nPara two."]);
    expect(splitPieces("Post one.\n\nStill one.\n---\nPost two.")).toEqual(["Post one.\n\nStill one.", "Post two."]);
    expect(splitPieces("Post one.\n\n\nPost two.")).toEqual(["Post one.", "Post two."]);
  });

  it("strips footers, contact lines, wrapped attributions and auto-replies from email", () => {
    const mail = [
      "Hi Sam,", "", "Here is the plan for Tuesday. Let's keep it short.", "",
      "Best,", "Riya", "+91 98765 43210 | riya@example.com",
      "This email and any attachments are confidential and intended only for the addressee.",
    ].join("\n");
    const out = stripEmail(mail);
    expect(out).toContain("Here is the plan for Tuesday.");
    expect(out).not.toMatch(/98765|example\.com|confidential/);
    expect(stripEmail("Thanks.\n\nOn Mon, 3 Jun 2026 at 10:02, Sam <sam@x.com>\nwrote:\n> old")).toBe("Thanks.");
    expect(stripEmail("Automatic reply: I'm out of the office until Monday.")).toBe("");
  });

  it("takes links, @mentions, hashtags and platform boilerplate out before measuring", () => {
    const c = cleanForMeasure("Repost\nBig week. @someone https://x.com/a #money\nCelebrating 5 years at Acme!\nDone.");
    expect(c).toBe("Big week.\nDone.");
  });
});

describe("measuring respects privacy, platforms and recency (06)", () => {
  const emails = Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, channel: "email", private: true, body: `Rahul, can you send the deck by Friday. Thanks for the notes ${i}.\n\nBest,\nRiya` }));
  const posts = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, channel: "linkedin", private: false, body: `But most people never check. So start today ${i}.\n\nWhat would you change?` }));

  it("never measures a name from private writing as a sentence starter", () => {
    const m = measureCorpus([...emails, ...posts]);
    const starters = (m.mechanics.sentenceInitial?.value ?? []).map((w) => w.word);
    expect(starters).not.toContain("rahul");
    expect(starters).toContain("but");
  });

  it("builds a block per platform with five or more pieces; private blocks describe, never quote", () => {
    const m = measureCorpus([...emails, ...posts]);
    expect(m.channelBlocks.linkedin.register).toMatch(/Sentences average/);
    expect(m.channelBlocks.linkedin.closer).toMatch(/end on a question/);
    expect(m.channelBlocks.email.closer).toMatch(/Signs off "Best,"/);
    expect(JSON.stringify(m.channelBlocks.email)).not.toMatch(/Rahul|deck|Riya/);
  });

  it("measures the overall voice from a balanced, recent slice", () => {
    const many = Array.from({ length: CHANNEL_BALANCE_CAP + 50 }, (_, i) => ({ id: `m${i}`, channel: "email", private: true, body: `A long formal sentence that keeps going and going about nothing much at all number ${i}.` }));
    const m = measureCorpus([...many, ...posts]);
    expect(m.stats.pieces).toBe(CHANNEL_BALANCE_CAP + 50 + 6);
    expect(m.mechanics.sentences!.count).toBe(CHANNEL_BALANCE_CAP + 6);
  });

  it("flags stock machine phrasing for the person to confirm", () => {
    const odd = { id: "x", channel: "linkedin", private: false, body: "Let us delve into the tapestry of finance. In today's world it is a testament to effort." };
    const m = measureCorpus([...posts, odd]);
    expect(m.suspected.find((s) => s.id === "x")?.reason).toMatch(/stock phrases/);
  });
});

describe("the check tests what each platform needs (07)", () => {
  it("catches a draft that copies their writing word for word", () => {
    const corpus = ["Your first salary is not a reward, it is a test of what you do next."];
    expect(copiedRun("Remember: your first salary is not a reward, it is a test. Plan.", corpus)).toMatch(/first salary is not a reward/);
    expect(copiedRun("A completely different line about saving money every month.", corpus)).toBeNull();
  });

  it("flags markdown on WhatsApp, visual punctuation in a script, a long email subject and an over-long thread part", () => {
    const codes = (text: string, channel: string) => checkDraft(text, emptyIndex(), { channel }).issues.map((i) => i.code);
    expect(codes("## Update\n**Big** news today.", "whatsapp")).toContain("platform_format");
    expect(codes("So here's the thing (and it matters) / really.", "spoken")).toContain("spoken_visual");
    expect(codes(`${"A very long subject line that keeps going well past what any inbox will show"}\n\nHi, quick one.`, "email")).toContain("email_subject");
    const thread = `1/ ${"word ".repeat(30)}\n2/ ${"longer ".repeat(60)}`;
    const issues = checkDraft(thread, emptyIndex(), { channel: "x" }).issues;
    expect(issues.find((i) => i.code === "platform_limit")?.message).toMatch(/Part 2 of the thread/);
  });
});

describe("Gmail keeps a sample, not the mailbox (06 §1)", () => {
  it("reads every Nth message so about GMAIL_KEEP are kept across the range", () => {
    expect(sampleEvery(150)).toBe(1);
    expect(sampleEvery(1000)).toBe(Math.ceil(1000 / GMAIL_KEEP));
    expect(sampleEvery(50_000)).toBe(Math.ceil(2000 / GMAIL_KEEP));
  });

  it("asks Gmail for the chosen range and reads only the sampled messages", async () => {
    const seen: string[] = [];
    const body = Buffer.from("A properly written email about the plan for next quarter, what the last one taught me, and what I would change, long enough to keep as a piece of writing.").toString("base64url");
    const f: FetchLike = async (url) => {
      seen.push(url);
      if (url.includes("/messages?")) return new Response(JSON.stringify({ messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}` })), resultSizeEstimate: 10 }), { status: 200 });
      return new Response(JSON.stringify({ id: url.split("/messages/")[1].split("?")[0], payload: { mimeType: "text/plain", body: { data: body } } }), { status: 200 });
    };
    const page = await sentMailPage("tok", { months: 12, every: 5, offset: 0 }, f);
    expect(new URL(seen[0]).searchParams.get("q")).toBe("in:sent newer_than:12m");
    expect(page.scanned).toBe(10);
    expect(page.pieces.map((p) => p.externalId)).toEqual(["gmail:m0", "gmail:m5"]);
  });
});
