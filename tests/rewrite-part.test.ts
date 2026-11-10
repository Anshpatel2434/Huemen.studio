import { describe, it, expect } from "vitest";
import { mockRewritePart, rewritePart } from "@/lib/ai/tasks";

const hook = "Most founder brands sound the same because they were written by someone describing a founder.";

describe("rewrite_part stand-in (select and instruct)", () => {
  it("does visibly what was asked", () => {
    expect(mockRewritePart("I really think delegation is just hard. It takes practice.", "make it shorter")).toBe("I really think delegation is just hard.");
    expect(mockRewritePart("I really think delegation is just hard, for everyone.", "punchier")).toBe("I think delegation is hard.");
    expect(mockRewritePart("Delegation is a skill.", "turn it into a question")).toBe("Delegation is a skill?");
    expect(mockRewritePart("Delegation is a skill.", "more contrarian")).toBe("Unpopular opinion: delegation is a skill.");
    expect(mockRewritePart("It is what I do not do.", "more casual")).toBe("It's what I don't do.");
  });
  it("always changes something, and never leaves a never-word in", () => {
    expect(mockRewritePart(hook, "something completely unrecognised")).not.toBe(hook);
    expect(mockRewritePart("Let's leverage synergy here.", "shorter", ["synergy", "leverage"])).not.toMatch(/synergy|leverage/i);
  });
  it("reads its input the way the action writes it", () => {
    const input = ["Part kind: Hook", "Instruction: shorter", "Never use: guru", "", "Part:", "Be a guru. Then stop.", "", "Whole piece:", "Be a guru. Then stop.\nBody"].join("\n");
    expect(rewritePart.schema.parse(rewritePart.mock(input)).text).toBe("Be a.");
  });
});
