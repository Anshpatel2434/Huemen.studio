import { describe, expect, it } from "vitest";
import { sameWords } from "@/lib/data/foundation";

// 2026-11-18 new-account run: typed Do-words reverted to the measured list on save.
describe("brief Do-words keep what the person typed", () => {
  it("treats the shown list, reordered or recased, as unchanged", () => {
    expect(sameWords(["Pipeline", "agreed", "nobody"], ["nobody", "pipeline", "Agreed"])).toBe(true);
  });
  it("sees an edit as a change, so the typed words are saved", () => {
    expect(sameWords(["nobody", "pipeline", "agreed"], ["pipeline", "qualified opportunity", "next step"])).toBe(false);
    expect(sameWords(undefined, ["pipeline"])).toBe(false);
  });
});
