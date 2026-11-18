import { describe, expect, it } from "vitest";
import { buildBrandContext } from "@/lib/context/context-builder";
import { taskRules } from "./prompt";
import { rewriteInVoice, rewritePart } from "./tasks";

const ctx = buildBrandContext({});
const BRIEF = "The Topic, and the Pillar and Angle when the task gives them, are already decided and are binding.";

describe("a rewrite keeps the brief (M4)", () => {
  it("the whole-piece rewrite and the part rewrite both carry the brief rule", () => {
    expect(taskRules(rewriteInVoice.rules, ctx).join("\n")).toContain(BRIEF);
    expect(taskRules(rewritePart.rules, ctx).join("\n")).toContain(BRIEF);
  });
  it("the brief rule is the draft contract's own wording, not a paraphrase", () => {
    expect(taskRules(["brief"], ctx)).toEqual([BRIEF + " Write about that topic, from that pillar, in the shape the angle describes. Do not swap in an easier angle."]);
  });
});

describe("the facts a rewrite may use are the ones its block carries (C2)", () => {
  it("the facts rule names the facts, the stories and the offers, and not the samples", () => {
    const facts = taskRules(["facts"], ctx).join("\n");
    expect(facts).toContain("Facts they can stand behind");
    expect(facts).toContain("their stories");
    expect(facts).not.toContain("what their own samples say happened");
  });
});
