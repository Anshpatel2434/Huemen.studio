import { describe, expect, it } from "vitest";
import { cutAtSentence } from "./cut";

describe("cutAtSentence (M3, H2)", () => {
  it("returns text that fits whole, untouched", () => {
    expect(cutAtSentence("One line. Two lines.", 100)).toEqual({ text: "One line. Two lines.", cut: false });
  });

  it("cuts at the last sentence end inside the budget, never mid-sentence", () => {
    const text = "First sentence here. Second sentence is longer than the budget allows. Third.";
    const out = cutAtSentence(text, 40);
    expect(out).toEqual({ text: "First sentence here.", cut: true });
  });

  it("keeps a sentence that ends exactly at the budget", () => {
    const text = "Exactly twenty chars. Then more words follow after it.";
    expect(cutAtSentence(text, 21)).toEqual({ text: "Exactly twenty chars.", cut: true });
  });

  it("falls back to a word boundary when no sentence ends inside the budget", () => {
    const out = cutAtSentence("a very long run of words with no full stop anywhere in it", 20);
    expect(out.cut).toBe(true);
    expect(out.text).toBe("a very long run of");
    expect(out.text.length).toBeLessThanOrEqual(20);
  });

  it("does not treat a stop followed by no space as a sentence end (a decimal, a domain)", () => {
    const out = cutAtSentence("Grew 3.5x in a year across the board and then some more text", 30);
    expect(out.text.endsWith("3.5x")).toBe(false);
    expect(out.cut).toBe(true);
  });
});
