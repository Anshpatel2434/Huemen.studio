import { describe, expect, it } from "vitest";
import { unsupportedClaims } from "./facts";
import { checkDraft, MUST_FIX_CAP } from "./check";
import { vetFindings } from "./judge";
import { EMPTY_INDEX } from "./types";

const kinds = (draft: string, grounding = "") => unsupportedClaims(draft, grounding).map((c) => c.kind);

describe("unsupportedClaims", () => {
  it("flags a first-person number the brand context does not state", () => {
    expect(kinds("I've helped 40 founders land their first client.", "Stories: founders often stall.")).toContain("number");
  });

  it("lets a first-person number through when the brand context states it", () => {
    expect(kinds("I've helped 40 founders land their first client.", "Facts they can stand behind: 40 founders coached.")).not.toContain("number");
  });

  it("flags a percentage or an amount anywhere, first person or not", () => {
    expect(kinds("Brands see 30% more reach from this.")).toEqual(["number"]);
    expect(kinds("The retainer is £2,000 a month.")).toEqual(["number"]);
  });

  it("flags a first-person work claim the context does not record", () => {
    const found = unsupportedClaims("Last quarter we shipped a pricing tool in two days.", "");
    expect(found.map((c) => c.kind)).toEqual(expect.arrayContaining(["event", "number"]));
  });

  it("flags an event someone else did, unnamed", () => {
    expect(kinds("A client told me it changed their week.")).toEqual(["event"]);
  });

  it("flags a quoted line with a speaker that the context does not contain", () => {
    expect(kinds("“This changed everything for my business,” said one client.")).toContain("quote");
  });

  it("flags a named method the context does not name", () => {
    const found = unsupportedClaims("Our 3-Q Review catches drift early.", "");
    expect(found.find((c) => c.kind === "method")).toEqual({ kind: "method", excerpt: "Our 3-Q Review" });
  });

  it("does not flag a method the context names", () => {
    expect(kinds("Our 3-Q Review catches drift early.", "Pillars: How I work. Method: the 3-Q Review, run monthly.")).not.toContain("method");
  });

  it("lets a sentence through when its words run on from the brand context", () => {
    const story = "We killed the manual pricing spreadsheet last spring and never looked back.";
    expect(unsupportedClaims(story, story)).toEqual([]);
  });

  it("lets through a quote the brand context contains", () => {
    const grounding = "Their own words: “Best money I spent.”";
    expect(kinds("“Best money I spent.” said a client.", grounding)).not.toContain("quote");
  });

  it("leaves an opinion piece with no facts alone", () => {
    expect(unsupportedClaims("Most founders hate cold outreach. Start with the people who already know you. Churn spikes at renewal.", "")).toEqual([]);
  });

  it("ignores thread numbering when it reads the numbers", () => {
    expect(kinds("1/ Most founders hate cold outreach.\n2/ Start with people who know you.")).toEqual([]);
  });
});

describe("line-level fixes (lib/voice/judge vetFindings)", () => {
  const line = "I hear most founders say the pricing page is where the deal closes.";
  const draft = `Hook\n\n${line}\n\nBody`;
  const finding = (fix: string) => ({ line, verdict: "off" as const, attribute: "Facts", quote: "the pricing page", why: "States a claim.", fix });

  it("drops a fix that adds an invented event the line did not state", () => {
    const fix = "We shipped a pricing tool in two days, so the pricing page is where the deal closes.";
    const [out] = vetFindings(draft, [finding(fix)], [], "Stories: none about pricing tools.");
    expect(out.fix).toBe("");
  });

  it("keeps a fix that adds no new claim", () => {
    const fix = "Most founders say the pricing page is where the deal closes.";
    const [out] = vetFindings(draft, [finding(fix)], [], "Stories: none.");
    expect(out.fix).toBe(fix);
  });

  it("does not check facts when no grounding is given", () => {
    const fix = "We shipped a pricing tool in two days, so the pricing page is where the deal closes.";
    const [out] = vetFindings(draft, [finding(fix)], []);
    expect(out.fix).toBe(fix);
  });
});

describe("QA 2026-11-17 drafts (the sentences the run reported)", () => {
  it("flags the invented team events in the Slack draft", () => {
    const slack = [
      "We shipped a rough onboarding flow that got early sign-ups.",
      "We killed the manual pricing spreadsheet.",
      "Next we will test a pricing page built in two days.",
    ].join(" ");
    const events = unsupportedClaims(slack, "Stories: none about onboarding or pricing.").filter((c) => c.kind === "event");
    expect(events.map((c) => c.excerpt)).toEqual(expect.arrayContaining([
      "We shipped a rough onboarding flow that got early sign-ups.",
      "We killed the manual pricing spreadsheet.",
    ]));
  });

  it("flags the invented named method in the Threads draft", () => {
    const threads = "I call it the 3-Q Review, and it keeps the roadmap honest each week.";
    expect(unsupportedClaims(threads, "How I work: a weekly roadmap check.").some((c) => c.kind === "method")).toBe(true);
  });

  it("flags the invented biography in the Bio draft", () => {
    const bio = "I built four products before I was thirty. “It saved our launch,” a client said.";
    const kinds = unsupportedClaims(bio, "Origin: a solo founder who runs workshops.").map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["event", "number", "quote"]));
  });
});

describe("checkDraft on the brand check", () => {
  it("turns a flagged claim into a must-fix finding and caps the score below On brand", () => {
    const r = checkDraft("I built four products in two years. Nobody believes it until they see them.", EMPTY_INDEX, {
      grounding: "Their brief: they sell coaching.",
    });
    const claim = r.issues.find((i) => i.code === "unsupported_claim");
    expect(claim?.mustFix).toBe(true);
    expect(claim?.severity).toBe("warning");
    expect(r.score).toBeLessThanOrEqual(MUST_FIX_CAP);
    expect(r.band).not.toBe("on_brand");
  });

  it("does not check facts when no grounding is given (nothing to check against)", () => {
    const r = checkDraft("I built four products in two years.", EMPTY_INDEX);
    expect(r.issues.some((i) => i.code === "unsupported_claim")).toBe(false);
  });

  it("flags an X post over 280 characters as a must-fix, with the length in the message", () => {
    const post = "Onboarding is the real price signal, not the pitch deck you rehearsed. ".repeat(6).trim();
    expect(post.length).toBeGreaterThan(280);
    const r = checkDraft(post, EMPTY_INDEX, { channel: "x", grounding: "" });
    const limit = r.issues.find((i) => i.code === "platform_limit");
    expect(limit?.mustFix).toBe(true);
    expect(limit?.message).toContain(`${post.length} characters`);
    expect(r.score).toBeLessThanOrEqual(MUST_FIX_CAP);
  });

  it("does not flag an X post at or under 280 characters", () => {
    const post = "Onboarding is the real price signal, not the deck you rehearsed.";
    const r = checkDraft(post, EMPTY_INDEX, { channel: "x", grounding: "" });
    expect(r.issues.some((i) => i.code === "platform_limit")).toBe(false);
  });
});
