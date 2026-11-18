/**
 * The 2026-11-17 writing-quality round (two QA passes with a real model):
 * what a draft is told, what the code does to model text, how the brand check
 * scores and vets, and the content plumbing around it (traceability, history
 * labels, topics, ids, exports, the calendar).
 *
 * The first half is pure. The second half runs against the database with the
 * stand-in provider (vitest.config pins it), like tests/studio.test.ts.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { assemblePrompt, taskRules } from "@/lib/ai/prompt";
import { voiceJudge, rewriteInVoice, coWriteOutline } from "@/lib/ai/tasks";
import { buildBrandContext } from "@/lib/context/context-builder";
import { cleanDeep, cleanModelText, streamCleaner } from "@/lib/content/clean";
import { findPlaceholders, pieceText, isHookSet } from "@/lib/content/formats";
import { angleLine } from "@/lib/content/angles";
import { isUuid, uuidOrNull } from "@/lib/content/ids";
import { currentVersionId, versionLabel, type VersionRow } from "@/lib/content/history";
import { bandFor, checkDraft, findPhrase, MUST_FIX_CAP } from "@/lib/voice/check";
import { applyFinding, flaggedPhrases, hasLine, vetFindings, withLineFindings } from "@/lib/voice/judge";
import { EMPTY_INDEX } from "@/lib/voice/types";
import { buildMarkdown, escapeMarkdownText, exportFileName } from "@/lib/export/markdown";
import { createProject, getProject, type ProjectScope, type WorkspaceScope } from "@/lib/data/projects";
import {
  applyVariant, ContentNotFoundError, deleteContent, generateContent, listContent, patchContent, recordRewrite, regenerateWithSteer,
  streamContent, updateContent, keepCurrentVersion,
} from "@/lib/data/content";
import { coWrite, pieceName, pieceTopic, sameTopic, saveTopic, startPiece, StartNotFoundError, NAME_MAX } from "@/lib/data/create";
import { judgeText } from "@/lib/data/check";
import { addCalendarEntry, captureIdea, getIdea, isIsoDate, listCalendar, listIdeas, moveCalendarEntry, deleteCalendarEntry, setIdeaPillar } from "@/lib/data/planning";

const NBH = "‑"; // non-breaking hyphen
const HY = "‐"; // hyphen
const NBSP = " ";
const EM = "—";

// ---------------------------------------------------------------- A4: clean ---

describe("model text is cleaned in one place (A4)", () => {
  it("turns non-breaking hyphens and spaces into what a keyboard types", () => {
    expect(cleanModelText(`A two${NBH}week sprint, well${HY}run,${NBSP}for 5${NBSP}people`)).toBe("A two-week sprint, well-run, for 5 people");
  });
  it("leaves em dashes alone unless the voice has none", () => {
    const line = `It works ${EM} mostly.`;
    expect(cleanModelText(line)).toBe(line);
    expect(cleanModelText(line, { noEmDash: true })).toBe("It works, mostly.");
    expect(cleanModelText(`${EM} a list item\nEnd of line ${EM}\nword${EM}word`, { noEmDash: true })).toBe("- a list item\nEnd of line\nword, word");
  });
  it("cleans a stream piece by piece to exactly what cleaning the whole gives", () => {
    const text = `Pricing is a two${NBH}way bet ${EM} you price,${NBSP}they decide.\n${EM} first point\nIt ends here ${EM}`;
    for (const size of [1, 2, 3, 5, 8, 100]) {
      for (const noEmDash of [true, false]) {
        const c = streamCleaner({ noEmDash });
        let out = "";
        for (let i = 0; i < text.length; i += size) out += c.push(text.slice(i, i + size));
        out += c.flush();
        expect(out, `size ${size}, noEmDash ${noEmDash}`).toBe(cleanModelText(text, { noEmDash }));
      }
    }
  });
  it("cleans every string of a task answer except the fields that quote the input", () => {
    const got = cleanDeep({ findings: [{ line: `a${NBH}b`, quote: `a${NBH}b`, fix: `a${NBH}c`, n: 2 }] }, {}, ["line", "quote"]);
    expect(got).toEqual({ findings: [{ line: `a${NBH}b`, quote: `a${NBH}b`, fix: "a-c", n: 2 }] });
  });
  it("the context says whether em dashes are theirs, and the judge keeps its quotes verbatim", () => {
    expect(buildBrandContext({ voicePack: { noEmDash: true } }).writing.noEmDash).toBe(true);
    expect(buildBrandContext({}).writing).toEqual({ lengthWords: null, noEmDash: false });
    expect(voiceJudge.verbatim).toEqual(["line", "quote"]);
  });
});

// ------------------------------------------------- A1, A3, A5, A6: contract ---

describe("the draft contract (A1, A3, A5, A6)", () => {
  const ctx = buildBrandContext({ voicePack: { lengthWords: [32, 57], noEmDash: true, mechanicsLines: ["Sentences average 9 words."] } });
  const task = ["Format: LinkedIn post", "Topic: Pricing", "Pillar: Pricing with nerve", angleLine("A story from the work")].join("\n");
  const prompt = assemblePrompt("You write LinkedIn posts.", ctx, task, { templateKey: "linkedin_post", variants: 2 });

  it("puts the facts rule first, names the fact sources, and prefers no placeholder", () => {
    const rules = prompt.user.slice(prompt.user.indexOf("Hard rules"));
    expect(rules).toMatch(/^Hard rules[^\n]*\n1\. Never invent a fact\./);
    expect(rules).toContain("Facts they can stand behind");
    expect(rules).toContain("What they sell");
    expect(rules).toContain("Every first-person claim that something happened");
    expect(rules).toContain("rewrite the sentence so it does not");
    expect(rules).toContain("No placeholder is better than one.");
  });
  it("binds the call to action to real offers, named exactly", () => {
    expect(prompt.user).toContain('exactly as it appears under "What they sell"');
    expect(prompt.user).toContain("most pieces need no offer");
    expect(prompt.user).toContain("Never invite a call, a chat or a DM, and never promise a download, a template");
    expect(prompt.user).toContain("or leave the call to action out");
    expect(prompt.user).toContain('An unnamed "a founder", "a client" or "one team" who did a particular thing is still an invented event.');
  });
  it("states the measured length as numbers, in the contract and in the block", () => {
    expect(prompt.user).toContain("Length: 32 to 57 words for the whole piece, hook and call to action included; aim for about 45.");
    expect(prompt.system).toContain("Length for this platform: 32 to 57 words a piece");
    const none = assemblePrompt("T", buildBrandContext({}), task, { templateKey: "linkedin_post", variants: 2 });
    expect(none.user).toContain("Length: nothing measured for this platform yet");
  });
  it("says the pillar and angle are binding, and the task carries what the angle asks", () => {
    expect(prompt.user).toContain("are already decided and are binding");
    expect(prompt.user).toContain("Pillar: Pricing with nerve");
    expect(prompt.user).toContain("Angle: A story from the work (tell it as a story in order");
    expect(prompt.user).toContain("without claiming a particular client, date or number");
    expect(angleLine("Open on a confession. Close with: reply")).toBe("Angle: Open on a confession. Close with: reply");
    expect(angleLine("  ")).toBe("");
  });
  it("asks for plain characters, and no em dashes when they have none", () => {
    expect(prompt.user).toContain("never non-breaking hyphens or non-breaking spaces");
    expect(prompt.user).toContain("No em dashes: they do not use them.");
  });
  it("keeps the same rules on the streamed draft and leaves length and the ask out of a hook set", () => {
    const streamed = assemblePrompt("T", ctx, task, { templateKey: "linkedin_post", variants: 2, stream: true });
    expect(streamed.user).toContain("1. Never invent a fact.");
    expect(streamed.user).toContain("Length: 32 to 57 words");
    const hooks = assemblePrompt("T", ctx, task, { templateKey: "linkedin_hook_set", variants: 2 });
    expect(hooks.user).toContain("1. Never invent a fact.");
    expect(hooks.user).not.toContain("Length: 32 to 57");
    expect(hooks.user).not.toContain("The call to action asks only for something real");
  });
  it("holds a rewrite and an outline to the same rules", () => {
    // A rewrite keeps the brief too (M4, 2026-11-18 audit).
    expect(rewriteInVoice.rules).toEqual(["facts", "brief", "length", "chars"]);
    const lines = taskRules(rewriteInVoice.rules, ctx).join("\n");
    expect(lines).toContain("their own pieces for this platform run 32 to 57 words");
    expect(lines).toContain("Never invent a fact.");
    expect(lines).toContain("are already decided and are binding.");
    expect(taskRules(coWriteOutline.rules, ctx).join("\n")).toContain("exactly as it appears under");
    expect(taskRules(undefined, ctx)).toEqual([]);
  });
});

// --------------------------------------------------------- A2: placeholders ---

describe("placeholders are found by code (A2)", () => {
  it("finds them whatever the case, with a currency sign or a note", () => {
    expect(findPlaceholders("We grew [placeholder] in a year")).toEqual(["[placeholder]"]);
    expect(findPlaceholders("It cost $[Placeholder] and [PLACEHOLDER: client name].")).toEqual(["$[Placeholder]", "[PLACEHOLDER: client name]"]);
    expect(findPlaceholders("An input placeholder, and [a bracketed aside].")).toEqual([]);
  });
  it("is a must-fix finding: the piece can never be on brand with one in it", () => {
    const r = checkDraft("Send the numbers on Friday. We saved [placeholder] hours.", EMPTY_INDEX);
    const hit = r.issues.find((i) => i.code === "placeholder")!;
    expect(hit.message).toBe("A placeholder is still in the copy.");
    expect(hit.mustFix).toBe(true);
    expect(hit.severity).toBe("error");
    expect(r.score).toBeLessThanOrEqual(MUST_FIX_CAP);
    expect(r.band).not.toBe("on_brand");
    expect(checkDraft("Send the numbers on Friday.", EMPTY_INDEX).band).toBe("on_brand");
  });
  it("helpers for the Content step", () => {
    expect(pieceText({ hook: " Hook ", body: "Body\n\nMore", cta: "" })).toBe("Hook\n\nBody\n\nMore");
    expect(isHookSet("hook_set")).toBe(true);
    expect(isHookSet("linkedin_post")).toBe(false);
  });
});

// ------------------------------------------------------- B1, B4: the score ---

describe("the band follows the findings (B1, B4)", () => {
  const noBang = { ...EMPTY_INDEX, punctuation: { exclamation: { allowed: false } } } as typeof EMPTY_INDEX;

  it("counts hard-rule breaks one by one: hype copy is off brand, not drifting", () => {
    const hype = "This is HUGE! Our game-changing launch is here! Wow! So excited! Join us! Now! Today! Go! #growth #winning #blessed";
    const r = checkDraft(hype, noBang, { channel: "linkedin", corpusPieces: 12, hashtagsPerPiece: 0 });
    expect(r.issues.find((i) => i.code === "punctuation_unused")!.weight).toBe(8);
    expect(r.issues.find((i) => i.code === "hashtags_unused")!.weight).toBe(3);
    expect(r.issues.some((i) => i.code === "watch_phrase" && i.mustFix)).toBe(true);
    expect(r.band).toBe("off_brand");
  });
  it("does not call hashtags a break without a real corpus that has none", () => {
    expect(checkDraft("A line. #tag", EMPTY_INDEX, { corpusPieces: 12, hashtagsPerPiece: 1.5 }).issues.map((i) => i.code)).not.toContain("hashtags_unused");
    expect(checkDraft("A line. #tag", EMPTY_INDEX, { corpusPieces: 1, hashtagsPerPiece: 0 }).issues.map((i) => i.code)).not.toContain("hashtags_unused");
  });
  it("caps a piece at double its usual length under on brand", () => {
    const index = { ...EMPTY_INDEX, lengthByFormat: { linkedin: [32, 57] as [number, number] } };
    const long = Array.from({ length: 107 }, (_, i) => (i % 9 === 8 ? "word." : "word")).join(" ");
    const r = checkDraft(long, index, { channel: "linkedin" });
    const hit = r.issues.find((i) => i.code === "too_long")!;
    expect(hit.message).toBe("107 words. Yours usually run 32–57.");
    expect(hit.mustFix).toBe(true);
    expect(r.band).not.toBe("on_brand");
  });
  it("counts a never-word each time it appears", () => {
    const r = checkDraft("We leverage this. Then we leverage that.", { ...EMPTY_INDEX, neverWords: ["leverage"] });
    expect(r.issues[0]).toMatchObject({ code: "never_word", weight: 2, mustFix: true });
  });
  it("cuts a snippet at word boundaries, with an ellipsis where text is left out", () => {
    const text = "Nobody asked for another transformative ecosystem of seamlessly integrated dashboards this quarter, honestly.";
    const s = findPhrase(text, "seamlessly")!;
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    const inner = s.replace(/^…|…$/g, "");
    expect(text).toContain(inner);
    // Whole words on both edges: the characters next to the cut are spaces.
    const at = text.indexOf(inner);
    expect(text[at - 1]).toBe(" ");
    expect(text[at + inner.length]).toBe(" ");
    expect(findPhrase("Short line with delve in it.", "delve")).toBe("Short line with delve in it.");
    expect(findPhrase("A revolutionary idea", "revolution")).toBe("A revolutionary idea");
  });
  it("a line read as off brand caps the score under on brand", () => {
    const clean = checkDraft("Send the numbers on Friday.", EMPTY_INDEX);
    expect(clean.band).toBe("on_brand");
    const withOff = withLineFindings(clean, [{ verdict: "off" }]);
    expect(withOff.score).toBeLessThanOrEqual(MUST_FIX_CAP);
    expect(withOff.band).toBe("drifting");
    expect(withLineFindings(clean, [{ verdict: "drift" }]).band).toBe(bandFor(clean.score - 3));
    expect(withLineFindings(clean, [])).toBe(clean);
  });
});

// ----------------------------------------------------- B2, B3: the findings ---

describe("the model's findings are vetted in code (B2, B3)", () => {
  const draft = "In today's fast-paced world, founders ship late.\nWe add features right up to launch.\nWe can ship on Friday.";
  const f = (over: Partial<Parameters<typeof vetFindings>[1][number]>) => ({
    line: "We add features right up to launch.", verdict: "drift" as const, attribute: "Rhythm", quote: "right up to launch", why: "x", fix: "We stop adding features a week before launch.", ...over,
  });
  const banned = ["in today's fast-paced world", "leverage"];

  it("names what the check flags in a draft", () => {
    expect(flaggedPhrases(draft, { neverWords: ["leverage", "ship"], allowedExceptions: [] })).toEqual(["ship", "in today's fast-paced world"]);
    expect(flaggedPhrases(draft, { neverWords: [], allowedExceptions: ["in today's fast-paced world"] })).toEqual([]);
  });
  it("drops a finding whose reason is about words that are not in the line", () => {
    const out = vetFindings(draft, [f({ line: "We can ship on Friday.", quote: "can't", why: "missing contraction on can't" }), f({})], banned);
    expect(out.map((x) => x.line)).toEqual(["We add features right up to launch."]);
  });
  it("drops a finding whose line is not in the draft", () => {
    expect(vetFindings(draft, [f({ line: "A line the model made up." })], banned)).toEqual([]);
  });
  it("rejects a fix that still carries a flagged phrase, and keeps the finding without one", () => {
    const line = "In today's fast-paced world, founders ship late.";
    const [kept] = vetFindings(draft, [f({ line, quote: "In today's fast-paced world", verdict: "off", fix: "In today's fast-paced world, founders are late." })], banned);
    expect(kept.fix).toBe("");
    expect(kept.remove).toBe(false);
    const [good] = vetFindings(draft, [f({ line, quote: "In today's fast-paced world", verdict: "off", fix: "Founders ship late." })], banned);
    expect(good.fix).toBe("Founders ship late.");
  });
  it("reads an empty fix as cut the line, and a fix that changes nothing as no fix", () => {
    const [cut] = vetFindings(draft, [f({ fix: "" })], banned);
    expect(cut.remove).toBe(true);
    const [same] = vetFindings(draft, [f({ fix: "We add features right up to launch." })], banned);
    expect(same).toMatchObject({ fix: "", remove: false });
  });
  it("applies a fix or a cut where the line stands, whatever the spacing", () => {
    expect(applyFinding(draft, { line: "We add features right up to launch.", fix: "We stop a week early.", remove: false })).toContain("founders ship late.\nWe stop a week early.\nWe can ship");
    expect(applyFinding(draft, { line: "We add features right up to launch.", fix: "", remove: true })).toBe("In today's fast-paced world, founders ship late.\nWe can ship on Friday.");
    expect(applyFinding(draft, { line: "Not there.", fix: "x", remove: false })).toBeNull();
    expect(hasLine("one\ntwo three", "one two")).toBe(true);
    expect(applyFinding("one\ntwo three", { line: "one two", fix: "1 2", remove: false })).toBe("1 2 three");
  });
  it("the judge is told what a fix must do", () => {
    expect(voiceJudge.contract).toContain("quote: the exact words inside that line");
    expect(voiceJudge.contract).toContain("never two full clauses joined by only a comma");
    expect(voiceJudge.contract).toContain("return an empty string, which means cut the line");
    expect(voiceJudge.contract).toContain("Already flagged");
  });
});

// ------------------------------------------------- C3: history, D2/D3: export ---

describe("history labels and the current version (C3)", () => {
  const row = (o: Partial<VersionRow>): VersionRow => ({ id: "x", variantIndex: 0, steer: null, model: "m", hook: "h", body: "b", cta: "c", ...o });
  it("names a version by where it came from", () => {
    const all = [row({ id: "a" }), row({ id: "b", variantIndex: 1 })];
    expect(versionLabel(all[0], all)).toBe("Draft 1");
    expect(versionLabel(all[1], all)).toBe("Draft 2");
    expect(versionLabel(row({}), [row({})])).toBe("Draft");
    expect(versionLabel(row({ steer: "Shorter" }))).toBe("Rewrite: Shorter");
    expect(versionLabel(row({ steer: "Rewrite: in my voice" }))).toBe("Rewrite: in my voice");
    expect(versionLabel(row({ model: null, steer: "Edited by you" }))).toBe("Edited by you");
    expect(versionLabel(row({ model: "own-writing" }))).toBe("Your own writing");
    expect(versionLabel(row({ model: "co-write-outline" }))).toBe("Outline");
  });
  it("marks the newest version with the piece's words as current", () => {
    const h = [row({ id: "a" }), row({ id: "b", hook: "other" }), row({ id: "c" })];
    expect(currentVersionId({ hook: "h", body: "b", cta: "c" }, h)).toBe("c");
    expect(currentVersionId({ hook: "typed since", body: "b", cta: "c" }, h)).toBeNull();
  });
});

describe("exports (D2, D3)", () => {
  it("escapes raw HTML in user text", () => {
    expect(escapeMarkdownText('<img src=x onerror="alert(1)"> & <b>bold</b>')).toBe('&lt;img src=x onerror="alert(1)"&gt; &amp; &lt;b&gt;bold&lt;/b&gt;');
    const md = buildMarkdown({
      brandName: "Priya <script>", generatedAt: new Date("2026-11-17T00:00:00Z"), pillars: [], calendar: [], offers: [],
      foundation: { niche: "", positioning: "", audience: "", chapters: [], tone: "", readingLevel: "", doWords: "", dontWords: "", palette: "", fonts: "", imageStyleNotes: "" } as never,
      content: [{ format: "linkedin_post", topic: "A <b>topic</b>", status: "draft", pillarName: null, hook: "<script>alert(1)</script>", body: "Tom & Jerry > all", cta: "<a href=x>go</a>" } as never],
    });
    expect(md).not.toMatch(/<script|<b>|<a /);
    expect(md).toContain("**&lt;script&gt;alert(1)&lt;/script&gt;**");
    expect(md).toContain("Tom &amp; Jerry &gt; all");
  });
  it("names the file after the brand and the piece of work", () => {
    expect(exportFileName("Priya Nair", "Why founders price too low", "md")).toBe("priya-nair-why-founders-price-too-low-brief.md");
    expect(exportFileName("Priya Nair", "", "pdf")).toBe("priya-nair-brief.pdf");
    expect(exportFileName("", null, "pdf")).toBe("brand-brief.pdf");
    expect(exportFileName("Acme", "x".repeat(200), "md").length).toBeLessThan(80);
  });
});

// ------------------------------------------------------ D1, D5, D6: helpers ---

describe("topics, ids and dates (D1, D5, D6, D7)", () => {
  it("cuts a long topic for the NAME at a word, with an ellipsis", () => {
    const topic = "Why most founders describe what they do instead of who it is for, and what happens to their pipeline when they finally turn the sentence around and say it plainly";
    const name = pieceName(topic);
    expect(name.length).toBeLessThanOrEqual(NAME_MAX + 1);
    expect(name.endsWith("…")).toBe(true);
    expect(topic.startsWith(name.slice(0, -1))).toBe(true);
    expect(topic[name.length - 1]).toMatch(/[\s,]/); // the cut falls between words
    expect(pieceName("Short topic")).toBe("Short topic");
    expect(pieceTopic({ name, description: topic })).toBe(topic);
    expect(pieceTopic({ name: "Short", description: "A note about something else entirely, typed when the project was made" })).toBe("Short");
    expect(pieceTopic({ name: "Short", description: null })).toBe("Short");
  });
  it("knows a suggestion that has already been written", () => {
    expect(sameTopic("Why founders price too low", "why founders price too low.")).toBe(true);
    expect(sameTopic("Why most founders describe what they do instead of who it is for, and what happens", "Why most founders describe what they do instead of who it is for…")).toBe(true);
    expect(sameTopic("Pricing", "Pricing with nerve")).toBe(false);
    expect(sameTopic("", "x")).toBe(false);
  });
  it("tells an id from text, and a day from a string", () => {
    expect(isUuid("3f2c1a9e-7b4d-4c8a-9e1f-2a6b5c4d3e2f")).toBe(true);
    expect(isUuid("3f2c1a9e")).toBe(false);
    expect(isUuid("'; drop table projects;--")).toBe(false);
    expect(uuidOrNull("nope")).toBeNull();
    expect(isIsoDate("2026-11-30")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("30/11/2026")).toBe(false);
  });
});

// ============================================================ with the database ===

let db = false;
let A: ProjectScope;
let B: WorkspaceScope;
const ADMIN = { tenantId: null, userId: null, isPlatformAdmin: true };

async function makeTenant(name: string): Promise<string> {
  return withTenantSession(ADMIN, async (c) => (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id);
}
const logsFor = (scope: WorkspaceScope, itemId: string) =>
  withTenantSession(scope, async (c) => (await c.query<{ status: string }>("SELECT status FROM generation_logs WHERE content_item_id = $1", [itemId])).rows);
const unlinkedLogs = (scope: WorkspaceScope) =>
  withTenantSession(scope, async (c) => (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM generation_logs WHERE content_item_id IS NULL AND status = 'ok'")).rows[0].n);
const projectCount = (scope: WorkspaceScope) =>
  withTenantSession(scope, async (c) => (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM projects")).rows[0].n);

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    db = true;
  } catch {
    return;
  }
  const wa = { tenantId: await makeTenant("Writing A (test)"), userId: null, isPlatformAdmin: false };
  B = { tenantId: await makeTenant("Writing B (test)"), userId: null, isPlatformAdmin: false };
  A = { ...wa, projectId: await createProject(wa, "Writing project") };
});

afterAll(async () => {
  if (!db) return;
  await withTenantSession(ADMIN, (c) => c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId]]));
  await appPool().end();
});

describe("every model call made for a piece carries its content_item_id (C1)", () => {
  it("a new draft, a streamed draft, a steer, an outline and an in-project check", async () => {
    if (!db) return;
    const before = await unlinkedLogs(A);

    const drafted = await generateContent(A, { format: "linkedin_post", topic: "Tracing a draft" });
    expect((await logsFor(A, drafted)).length).toBe(1);

    let streamed = "";
    for await (const ev of streamContent(A, { format: "linkedin_post", topic: "Tracing a stream" })) if (ev.type === "saved") streamed = ev.id;
    expect((await logsFor(A, streamed)).length).toBe(1);

    await regenerateWithSteer(A, drafted, "Shorter");
    expect((await logsFor(A, drafted)).length).toBe(2);

    const outline = await coWrite(A, { format: "linkedin_post", topic: "Tracing an outline", angle: "A simple framework" });
    expect((await logsFor(A, outline)).length).toBe(1);

    const item = (await listContent(A)).find((i) => i.id === drafted)!;
    await judgeText(A, [item.hook, item.body, item.cta].join("\n\n"), "linkedin", drafted);
    expect((await logsFor(A, drafted)).length).toBe(3);

    // None of those calls was left without its piece.
    expect(await unlinkedLogs(A)).toBe(before);
  });
});

describe("history says who wrote what (C3)", () => {
  it("a steer is a rewrite, a model rewrite is not 'Edited by you', and typed words are", async () => {
    if (!db) return;
    const id = await generateContent(A, { format: "linkedin_post", topic: "History labels" });
    const labels = async () => {
      const item = (await listContent(A)).find((i) => i.id === id)!;
      return { item, labels: item.history.map((g) => versionLabel(g, item.history)) };
    };
    expect((await labels()).labels).toEqual(["Draft 1", "Draft 2"]);

    await regenerateWithSteer(A, id, "Shorter");
    expect((await labels()).labels.at(-1)).toBe("Rewrite: Shorter");

    // Words typed on the canvas, then a model rewrite of the whole piece.
    await patchContent(A, id, { body: "A body I typed myself." });
    await keepCurrentVersion(A, id);
    await patchContent(A, id, { hook: "Rewritten hook", body: "Rewritten body." });
    await recordRewrite(A, id, "in my voice", "mock-strong");
    const { item, labels: l } = await labels();
    expect(l.slice(-2)).toEqual(["Edited by you", "Rewrite: in my voice"]);
    expect(currentVersionId(item, item.history)).toBe(item.history.at(-1)!.id);

    // The same text is not recorded twice.
    await recordRewrite(A, id, "in my voice", "mock-strong");
    expect((await labels()).labels.length).toBe(l.length);

    // Using an older version keeps what was there, and that version becomes current.
    await applyVariant(A, id, item.history[0].id);
    const after = (await labels()).item;
    expect(currentVersionId(after, after.history)).toBe(item.history[0].id);
    expect(after.updatedAt >= after.createdAt).toBe(true);
  });
});

describe("a placeholder is marked on the piece (A2)", () => {
  it("lists the placeholders in a saved piece and scores it below on brand", async () => {
    if (!db) return;
    const id = await generateContent(A, { format: "linkedin_post", topic: "Placeholder marking" });
    await patchContent(A, id, { body: "We saved [placeholder] hours and $[placeholder] a month." });
    const item = (await listContent(A)).find((i) => i.id === id)!;
    expect(item.placeholders).toEqual(["[placeholder]", "$[placeholder]"]);
  });
});

describe("a long topic keeps all of itself (D1)", () => {
  const long = "Why most founders describe what they do instead of who it is for, and what happens to their pipeline when they finally turn the sentence around and say it plainly to the one buyer who matters";

  it("the project name is cut at a word; the whole topic is what the draft is written from", async () => {
    if (!db) return;
    const pid = await startPiece(A, { topic: long, format: "linkedin_post" });
    const p = (await getProject(A, pid))!;
    expect(p.name.endsWith("…")).toBe(true);
    expect(p.name.length).toBeLessThanOrEqual(NAME_MAX + 1);
    expect(pieceTopic(p)).toBe(long);
    expect(p.format).toBe("linkedin_post");

    const scope = { ...A, projectId: pid };
    const id = await generateContent(scope, { format: "linkedin_post", topic: pieceTopic(p) });
    expect((await listContent(scope)).find((i) => i.id === id)!.topic).toBe(long);

    // Ideate saves a new topic the same way, and a short one clears the long one.
    await saveTopic(scope, `${long} Again.`);
    expect(pieceTopic((await getProject(A, pid))!)).toBe(`${long} Again.`);
    await saveTopic(scope, "A short topic");
    const short = (await getProject(A, pid))!;
    expect(short.name).toBe("A short topic");
    expect(short.description).toBeNull();
  });
});

describe("ids from the browser are refused quietly (D5)", () => {
  it("starting a piece from an idea that is not an id, or is another workspace's, creates nothing", async () => {
    if (!db) return;
    await captureIdea(B, "An idea in another workspace");
    const foreign = (await listIdeas(B))[0].id;
    const before = await projectCount(A);
    await expect(startPiece(A, { topic: "Orphan check", ideaId: "not-an-id" })).rejects.toBeInstanceOf(StartNotFoundError);
    await expect(startPiece(A, { topic: "Orphan check", ideaId: foreign })).rejects.toBeInstanceOf(StartNotFoundError);
    await expect(startPiece(A, { topic: "Orphan check", pillarId: foreign })).rejects.toBeInstanceOf(StartNotFoundError);
    expect(await projectCount(A)).toBe(before);

    // A real idea of this workspace links, in the same statement that makes the project.
    await captureIdea(A, "An idea of our own");
    const own = (await listIdeas(A))[0].id;
    const pid = await startPiece(A, { topic: "From our idea", ideaId: own });
    expect((await getProject(A, pid))!.ideaId).toBe(own);
  });
  it("content and planning calls with a malformed id do nothing instead of raising a database error", async () => {
    if (!db) return;
    const bad = "'; select 1;--";
    await expect(patchContent(A, bad, { hook: "x" })).resolves.toBeUndefined();
    await expect(updateContent(A, bad, { hook: "x", body: "", cta: "", pillarId: bad, status: "edited" })).resolves.toBeUndefined();
    await expect(deleteContent(A, bad)).resolves.toBeUndefined();
    await expect(applyVariant(A, bad, bad)).rejects.toBeInstanceOf(ContentNotFoundError);
    await expect(regenerateWithSteer(A, bad, "Shorter")).rejects.toBeInstanceOf(ContentNotFoundError);
    await expect(deleteCalendarEntry(A, bad)).resolves.toBeUndefined();
    await expect(setIdeaPillar(A, bad, bad)).resolves.toBeUndefined();
    expect(await getIdea(A, bad)).toBeUndefined();
    expect(await moveCalendarEntry(A, bad, "2031-01-05")).toBe(false);
    // A pillar id that isn't one is dropped from a draft rather than failing it.
    const id = await generateContent(A, { format: "linkedin_post", topic: "Bad pillar", pillarId: bad });
    expect((await listContent(A)).find((i) => i.id === id)!.pillarId).toBeNull();
  });
});

describe("a calendar slot can be moved (D6)", () => {
  it("moves within the workspace only, and only to a real day", async () => {
    if (!db) return;
    await addCalendarEntry(A, { date: "2031-03-03", pillarId: null, channel: "linkedin", topic: "Move me", hookAngle: "", cta: "" });
    const slot = (await listCalendar(A, "2031-03-01", "2031-03-31"))[0];
    expect(await moveCalendarEntry(A, slot.id, "2031-02-31")).toBe(false);
    expect(await moveCalendarEntry(B, slot.id, "2031-03-10")).toBe(false);
    expect(await moveCalendarEntry(A, slot.id, "2031-03-10")).toBe(true);
    const moved = (await listCalendar(A, "2031-03-01", "2031-03-31"))[0];
    expect(moved).toMatchObject({ id: slot.id, date: "2031-03-10", topic: "Move me", channel: "linkedin" });
  });
});
