import { describe, expect, it } from "vitest";
import { asSentence } from "@/app/w/[id]/brand/sentence";

/** Brand core › Brief showed "...they can predict.." when the niche already ended in a full stop. */
describe("asSentence", () => {
  it("adds a full stop only when there isn't an end mark", () => {
    expect(asSentence("Growth for founders who want revenue they can predict")).toBe("Growth for founders who want revenue they can predict.");
    expect(asSentence("Growth for founders who want revenue they can predict.")).toBe("Growth for founders who want revenue they can predict.");
    expect(asSentence("Is it working?")).toBe("Is it working?");
    expect(asSentence("Ship it!")).toBe("Ship it!");
    expect(asSentence("And then…")).toBe("And then…");
  });

  it("sees an end mark before a closing quote or bracket", () => {
    expect(asSentence("They call it “clarity.”")).toBe("They call it “clarity.”");
    expect(asSentence("(It works.)")).toBe("(It works.)");
  });

  it("trims, and leaves empty text empty", () => {
    expect(asSentence("  Plain words  ")).toBe("Plain words.");
    expect(asSentence("   ")).toBe("");
  });
});
