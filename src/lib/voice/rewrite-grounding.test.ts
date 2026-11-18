import { describe, expect, it } from "vitest";
import { addedClaims, blockedRewriteMessage, UnsupportedRewriteError } from "./judge";

const GROUNDING = "Positioning: the brand professor for solo experts.\nFacts they can stand behind: 12 founders coached [case notes].";

describe("a rewrite may not add an unsupported claim (C2)", () => {
  it("flags a number the rewrite adds that the brand context does not state", () => {
    const before = "Most founders stall after the first hire.";
    const after = "Most founders stall after the first hire. I've helped 40 founders land it.";
    const added = addedClaims(before, after, GROUNDING);
    expect(added.map((c) => c.kind)).toContain("number");
    expect(added.some((c) => c.excerpt.includes("40 founders"))).toBe(true);
  });

  it("lets a number through when the brand context states it", () => {
    const added = addedClaims("Short.", "I've helped 12 founders land it.", GROUNDING);
    expect(added).toEqual([]);
  });

  it("does not block a claim the piece already made before the rewrite", () => {
    const before = "I've helped 40 founders land it. Keep that.";
    const after = "I've helped 40 founders land it, plainly.";
    expect(addedClaims(before, after, GROUNDING)).toEqual([]);
  });

  it("flags a new event, quote or named method, not only numbers", () => {
    const before = "Plain line about pricing.";
    const after = "A client told me it changed their week. Our 3-Q Review caught it.";
    const kinds = addedClaims(before, after, GROUNDING).map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["event", "method"]));
  });

  it("reads a fix that was cut for length as the same sentence", () => {
    const long = `${"I've helped 40 founders land their first client, and that took a long time to get right. ".repeat(3)}`;
    const before = long;
    expect(addedClaims(before, long, GROUNDING)).toEqual([]);
  });

  it("names what was added, and that nothing was changed, in the words the person is shown", () => {
    const claims = addedClaims("", "I've helped 40 founders land it.", GROUNDING);
    const message = blockedRewriteMessage(claims);
    expect(message).toMatch(/^Nothing was changed\. The rewrite adds “I've helped 40 founders land it\.”/);
    expect(message).toMatch(/Then ask again\.$/);
  });

  it("carries the claims and the rewrite on the error the actions catch", () => {
    const claims = addedClaims("", "I've helped 40 founders land it.", GROUNDING);
    const err = new UnsupportedRewriteError(claims, "I've helped 40 founders land it.");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UnsupportedRewriteError");
    expect(err.claims).toBe(claims);
    expect(err.rewrite).toBe("I've helped 40 founders land it.");
    expect(err.message).toBe(blockedRewriteMessage(claims));
  });
});
