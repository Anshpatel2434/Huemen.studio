import { describe, expect, it } from "vitest";
import { pieceEdit } from "./edit";

describe("pieceEdit (does the message change the open piece?)", () => {
  it("reads 'make the hook more contrarian' as a change to the hook, not a new piece", () => {
    expect(pieceEdit("make the hook more contrarian")).toEqual({ part: "hook" });
  });

  it("reads a change to the body, the call to action and the whole piece", () => {
    expect(pieceEdit("tighten the body")).toEqual({ part: "body" });
    expect(pieceEdit("make the call to action less pushy")).toEqual({ part: "cta" });
    expect(pieceEdit("make it punchier")).toEqual({ part: "whole" });
  });

  it("reads a length ask and a pillar move", () => {
    expect(pieceEdit("make this shorter")).toEqual({ part: "length" });
    expect(pieceEdit("move this to the Proof pillar")).toEqual({ part: "pillar" });
  });

  it("is not an edit when the person asks for a new piece", () => {
    expect(pieceEdit("draft a new hook, more contrarian")).toBeNull();
    expect(pieceEdit("make another one punchier")).toBeNull();
  });

  it("is not an edit when the message names a topic (a new piece about something)", () => {
    expect(pieceEdit("write the hook about pricing for freelancers")).toBeNull();
  });

  it("is not an edit when it does not refer to a piece", () => {
    expect(pieceEdit("three sharper angles")).toBeNull();
    expect(pieceEdit("what should the picture show?")).toBeNull();
    expect(pieceEdit("")).toBeNull();
  });
});
