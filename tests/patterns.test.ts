/**
 * Planted patterns: a fake corpus with habits we hid on purpose. The finder
 * must find each one, and must not report what we didn't plant.
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

/** 40 emails, 12 posts, 4 podcast transcripts, with three planted habits. */
function corpus(): PatternSample[] {
  const out: PatternSample[] = [];
  for (let i = 0; i < 40; i++) {
    // Planted 1: a catchphrase in 6 emails, 3 posts and 2 transcripts.
    const phrase = i < 6 ? "Pay yourself first, always." : "";
    // Planted 2: a topic explained in 10 emails, never posted.
    const topic = i % 4 === 0 ? "On term insurance: buy it early, keep the cover simple, skip the riders." : "";
    out.push(email(i, `${phrase} ${topic}`));
  }
  for (let i = 0; i < 12; i++) out.push(post(i, i < 3 ? "Pay yourself first, always." : ""));
  for (let i = 0; i < 4; i++) {
    out.push({ channel: "spoken", visibility: "public", body: `So on the show today. ${i < 2 ? "Pay yourself first, always." : ""} ${FILLER_LINES[i]}` });
  }
  return out;
}

describe("patterns hidden across sources", () => {
  it("finds the catchphrase said everywhere, with the channels it crossed", () => {
    const { everywhere } = findPatterns(corpus());
    const hit = everywhere.find((p) => p.phrase === "pay yourself first always");
    expect(hit).toBeDefined();
    expect(hit!.channels).toEqual(["email", "linkedin", "spoken"]);
    expect(hit!.pieces).toBe(11);
    // Only the longest form is reported, not its fragments.
    expect(everywhere.some((p) => p.phrase === "pay yourself")).toBe(false);
  });

  it("finds the topic explained privately but never posted, as a topic, not a quote", () => {
    const { privateOnly } = findPatterns(corpus());
    const terms = privateOnly.map((t) => t.term);
    expect(terms).toContain("term insurance");
    // The two-word term carries the single word, so the word isn't repeated.
    expect(terms).not.toContain("insurance");
    const t = privateOnly.find((x) => x.term === "term insurance")!;
    expect(t.pieces).toBe(10);
    expect(t.share).toBe(0.25);
  });

  it("never surfaces names, greetings or email housekeeping", () => {
    const { everywhere, privateOnly } = findPatterns(corpus());
    const all = [...everywhere.map((p) => p.phrase), ...privateOnly.map((t) => t.term)].join(" | ");
    expect(all).not.toMatch(/rahul|riya|thanks/i);
  });

  it("treats a subject as a topic, not a verbal signature, and ignores a weak single word", () => {
    const s: PatternSample[] = [];
    for (let i = 0; i < 4; i++) s.push({ channel: "email", visibility: "private", body: `On term insurance, keep the plan simple. Note ${i}.` });
    for (let i = 0; i < 3; i++) s.push({ channel: "linkedin", visibility: "public", body: `Why term insurance comes first. Post ${i}.` });
    const { everywhere, privateOnly } = findPatterns(s);
    expect(everywhere.map((p) => p.phrase)).not.toContain("term insurance");
    // "plan" in 4 of 4 emails is still under the single-word floor of 5.
    expect(privateOnly.map((t) => t.term)).not.toContain("plan");
  });

  it("says nothing about 'never posted' without posts to compare with", () => {
    const onlyEmail = corpus().filter((s) => s.visibility === "private");
    expect(findPatterns(onlyEmail).privateOnly).toEqual([]);
  });

  it("never names a phrase that was only ever said privately", () => {
    const privateTwoChannels: PatternSample[] = [];
    for (let i = 0; i < 4; i++) {
      privateTwoChannels.push({ channel: "email", visibility: "private", body: `the quarterly retainer fee stays the same ${i}` });
      privateTwoChannels.push({ channel: "whatsapp", visibility: "private", body: `the quarterly retainer fee stays the same, ok ${i}` });
    }
    expect(findPatterns(privateTwoChannels).everywhere).toEqual([]);
  });

  it("leaves out what the person already kept or dismissed", () => {
    const { everywhere, privateOnly } = findPatterns(corpus(), { skip: ["pay yourself first always", "term insurance"] });
    expect(everywhere.some((p) => p.phrase === "pay yourself first always")).toBe(false);
    expect(privateOnly.some((t) => t.term === "term insurance")).toBe(false);
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
