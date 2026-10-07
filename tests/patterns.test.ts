/**
 * Planted patterns: a fake corpus with habits we hid on purpose. The finder
 * must find each one, must not report what we didn't plant, and must never
 * surface anything that only appears in private writing (spec 06 §1).
 */
import { describe, expect, it } from "vitest";
import { findPatterns, type PatternSample } from "@/lib/voice/patterns";

const FILLER_LINES = [
  "Following up on the numbers from last month, the cohort filled faster than planned.",
  "We moved the workshop to a bigger room because the list kept growing.",
  "The deck is ready, I tightened the second half and cut two slides.",
  "Budget reviews went well, most people had a clearer picture than they expected.",
  "Next cohort opens soon, the waitlist is longer than the last one.",
  "I rewrote the welcome note so it reads less like a brochure.",
];

const email = (i: number, extra = ""): PatternSample => ({
  channel: "email",
  visibility: "private",
  body: `Hi Rahul,\n\n${FILLER_LINES[i % FILLER_LINES.length]} ${extra}\n\nThanks, Riya`,
});
const post = (i: number, extra = ""): PatternSample => ({
  channel: "linkedin",
  visibility: "public",
  body: `${FILLER_LINES[(i + 3) % FILLER_LINES.length]} ${extra}`,
});

/** 40 emails, 12 posts, 4 podcast transcripts, with planted habits. */
function corpus(): PatternSample[] {
  const out: PatternSample[] = [];
  for (let i = 0; i < 40; i++) {
    // Planted 1: a catchphrase in 6 emails, 3 posts and 2 transcripts.
    const phrase = i < 6 ? "Pay yourself first, always." : "";
    // Planted 2: a turn of phrase said only in email, never in public.
    const privatePhrase = i % 4 === 0 ? "Between you and me, the renewal is at risk." : "";
    out.push(email(i, `${phrase} ${privatePhrase}`));
  }
  for (let i = 0; i < 12; i++) out.push(post(i, i < 3 ? "Pay yourself first, always." : ""));
  for (let i = 0; i < 4; i++) {
    out.push({ channel: "spoken", visibility: "public", body: `So on the show today. ${i < 2 ? "Pay yourself first, always." : ""} ${FILLER_LINES[i]}` });
  }
  return out;
}

describe("phrases said across sources", () => {
  it("finds the catchphrase said everywhere, with the channels it crossed", () => {
    const { everywhere } = findPatterns(corpus());
    const hit = everywhere.find((p) => p.phrase === "pay yourself first always");
    expect(hit).toBeDefined();
    expect(hit!.channels).toEqual(["email", "linkedin", "spoken"]);
    expect(hit!.pieces).toBe(11);
    // Only the longest form is reported, not its fragments.
    expect(everywhere.some((p) => p.phrase === "pay yourself")).toBe(false);
  });

  it("never surfaces a phrase, name or detail found only in private writing", () => {
    const all = findPatterns(corpus()).everywhere.map((p) => p.phrase).join(" | ");
    expect(all).not.toMatch(/renewal|between you and me|rahul|riya|thanks/i);
  });

  it("treats a subject as a topic, not a verbal signature", () => {
    const s: PatternSample[] = [];
    for (let i = 0; i < 3; i++) s.push({ channel: "email", visibility: "private", body: `On term insurance, keep the plan simple. Note ${i}.` });
    for (let i = 0; i < 3; i++) s.push({ channel: "linkedin", visibility: "public", body: `Why term insurance comes first. Post ${i}.` });
    expect(findPatterns(s).everywhere.map((p) => p.phrase)).not.toContain("term insurance");
  });

  it("never names a phrase that was only ever said privately, even across two private channels", () => {
    const s: PatternSample[] = [];
    for (let i = 0; i < 4; i++) {
      s.push({ channel: "email", visibility: "private", body: `the quarterly retainer fee stays the same ${i}` });
      s.push({ channel: "whatsapp", visibility: "private", body: `the quarterly retainer fee stays the same, ok ${i}` });
    }
    expect(findPatterns(s).everywhere).toEqual([]);
  });

  it("ignores links, @mentions and hashtags when counting", () => {
    const s: PatternSample[] = [];
    for (let i = 0; i < 3; i++) s.push({ channel: "linkedin", visibility: "public", body: `Big week ${i}. #personalfinance @someone https://example.com/a` });
    for (let i = 0; i < 3; i++) s.push({ channel: "x", visibility: "public", body: `Short note ${i}. #personalfinance @someone https://example.com/a` });
    const all = findPatterns(s).everywhere.map((p) => p.phrase).join(" | ");
    expect(all).not.toMatch(/personalfinance|someone|example|https/);
  });

  it("leaves out what the person already kept or dismissed", () => {
    const { everywhere } = findPatterns(corpus(), { skip: ["pay yourself first always"] });
    expect(everywhere.some((p) => p.phrase === "pay yourself first always")).toBe(false);
  });

  it("handles a mailbox-sized corpus quickly", () => {
    const big: PatternSample[] = [];
    for (let i = 0; i < 2000; i++) big.push(email(i, FILLER_LINES.join(" ")));
    for (let i = 0; i < 60; i++) big.push(post(i));
    const t0 = Date.now();
    findPatterns(big);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
