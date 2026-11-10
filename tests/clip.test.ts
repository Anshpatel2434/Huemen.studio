import { describe, expect, it } from "vitest";
import { clip } from "@/lib/voice/derive";

describe("clip", () => {
  it("leaves short text alone", () => {
    expect(clip("  Just count.  ", 40)).toBe("Just count.");
  });

  it("cuts at a word boundary and marks the cut", () => {
    const out = clip("Would I still want it in thirty days? Two yes answers and you're fine.", 20);
    expect(out).toBe("Would I still want…");
    expect(out.length).toBeLessThanOrEqual(21);
  });

  it("never ends on dangling punctuation before the ellipsis", () => {
    expect(clip("Emergency fund first, three months of expenses.", 22)).toBe("Emergency fund first…");
  });

  it("falls back to a hard cut when there is no good space", () => {
    expect(clip("Supercalifragilisticexpialidocious words", 10)).toBe("Supercalif…");
  });
});
