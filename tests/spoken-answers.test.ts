/**
 * The spoken-answer length rule (lib/onboarding/spoken).
 *
 * Both onboarding flows gate "add these as spoken samples" on this, and both
 * used to enforce it silently with their own copy of the arithmetic. Someone
 * who answered all three questions in a few words each got a disabled button
 * under a note telling them to answer the questions.
 *
 * What matters here is not the number — it is that the number the screens
 * SHOW is the number they ENFORCE. These tests hold those together.
 */
import { describe, it, expect } from "vitest";
import { MIN_SPOKEN_WORDS, longEnough, spokenHint, wordsIn } from "@/lib/onboarding/spoken";

describe("counting words", () => {
  it("counts nothing for blank or whitespace", () => {
    expect(wordsIn("")).toBe(0);
    expect(wordsIn("   \n  ")).toBe(0);
  });

  it("counts words across any run of whitespace", () => {
    expect(wordsIn("Solve problems, for money")).toBe(4);
    expect(wordsIn("AI is bad")).toBe(3);
    expect(wordsIn("one\ntwo   three\t\tfour")).toBe(4);
  });
});

describe("what counts as long enough", () => {
  it("accepts an answer at the threshold and refuses one below it", () => {
    const at = Array.from({ length: MIN_SPOKEN_WORDS }, (_, i) => `w${i}`).join(" ");
    const under = Array.from({ length: MIN_SPOKEN_WORDS - 1 }, (_, i) => `w${i}`).join(" ");
    expect(longEnough(at)).toBe(true);
    expect(longEnough(under)).toBe(false);
  });

  // The exact answers that hit the bug: all three questions answered, button
  // still dead, note still claiming they were unanswered.
  it("refuses the short answers that first showed the problem", () => {
    const given = ["Solve problems, for money", "Always be genuine while solving problems", "AI is bad"];
    expect(given.some(longEnough)).toBe(false);
    // ...and every one of them now has something to show for itself.
    for (const g of given) expect(spokenHint(g)).not.toBeNull();
  });

  it("passes once one answer is a real sentence", () => {
    const given = [
      "I solve messy problems for founders who are paying me to make the mess smaller.",
      "AI is bad",
    ];
    expect(given.some(longEnough)).toBe(true);
  });
});

describe("what the screen shows", () => {
  it("says nothing about an untouched box", () => {
    expect(spokenHint("")).toBeNull();
    expect(spokenHint("  ")).toBeNull();
  });

  it("shows the shortfall against the same number that is enforced", () => {
    const hint = spokenHint("AI is bad");
    expect(hint).toEqual({ text: `3 of about ${MIN_SPOKEN_WORDS} words`, ok: false });
    // The gate and the hint must never disagree.
    expect(hint!.ok).toBe(longEnough("AI is bad"));
  });

  it("confirms an answer that is long enough", () => {
    const text = "I solve messy problems for founders who are paying me to make the mess smaller.";
    const hint = spokenHint(text);
    expect(hint!.ok).toBe(true);
    expect(hint!.ok).toBe(longEnough(text));
    expect(hint!.text).toContain("that works");
  });

  // The whole point: for any input, the hint's verdict is the gate's verdict.
  it("never disagrees with the gate, for any answer", () => {
    const samples = ["", " ", "one", "one two three", "a b c d e f g h i", "a b c d e f g h i j", "a b c d e f g h i j k"];
    for (const s of samples) {
      const hint = spokenHint(s);
      if (hint === null) expect(longEnough(s)).toBe(false);
      else expect(hint.ok).toBe(longEnough(s));
    }
  });
});
