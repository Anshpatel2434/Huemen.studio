/**
 * 2026-11-18 agent test: named commands are read before edits of the open
 * piece, and the agent's task tells it what is already written.
 */
import { describe, expect, it } from "vitest";
import { namedCommand } from "@/lib/agent-ui/commands";
import { pieceEdit } from "@/lib/agent-ui/edit";
import { agentTask } from "@/lib/agent-ui/prompt";

describe("named agent commands", () => {
  it("an idea that contains an edit word is still an idea", () => {
    const msg = "Idea: the Monday meeting cost us 15 hours a week before I cut it";
    // Why the order matters: on its own this reads as an edit ("cut").
    expect(pieceEdit(msg)).not.toBeNull();
    expect(namedCommand(msg)).toEqual({ type: "idea", text: "the Monday meeting cost us 15 hours a week before I cut it" });
  });

  it("reads note and capture as ideas", () => {
    expect(namedCommand("note - shorter meetings win")).toEqual({ type: "idea", text: "shorter meetings win" });
    expect(namedCommand("Capture: rewrite the pricing page")?.type).toBe("idea");
  });

  it("reads add pillar in its usual forms", () => {
    expect(namedCommand("Add pillar: Forecast Honesty")).toEqual({ type: "pillar", name: "Forecast Honesty" });
    expect(namedCommand("add a pillar called “Forecast Honesty”")).toEqual({ type: "pillar", name: "Forecast Honesty" });
    expect(namedCommand("Can you create a new pillar named Pricing?")).toEqual({ type: "pillar", name: "Pricing" });
  });

  it("leaves edits and questions alone", () => {
    expect(namedCommand("Make the opening line shorter")).toBeNull();
    expect(namedCommand("What should I write next?")).toBeNull();
    expect(namedCommand("Idea:")).toBeNull();
    expect(namedCommand("Move this to the Pipeline Leak pillar")).toBeNull();
  });
});

describe("agent task", () => {
  const base = { question: "What should I write next?", earlier: [], completeness: 91, warnings: [] };

  it("lists pillars with their counts and what is already written", () => {
    const t = agentTask({
      ...base,
      project: { name: "Why your forecast misses", stage: "content", pieces: 1 },
      pillars: [{ name: "Pipeline Leak", pieces: 0, ideas: 1, slots: 0 }, { name: "Monday Reset", pieces: 2, ideas: 0, slots: 1 }],
      written: [{ hook: "Same deal. Two different answers.", pillar: "Qualified Opportunity", format: "linkedin_post" }],
      aboutBrief: false,
    });
    expect(t).toContain("Open project: Why your forecast misses (stage: content, 1 piece written)");
    expect(t).toContain("- Pipeline Leak: 0 pieces, 1 idea, 0 calendar slots");
    expect(t).toContain("- Monday Reset: 2 pieces, 0 ideas, 1 calendar slot");
    expect(t).toContain('Already written (never suggest these again as new posts):\n- "Same deal. Two different answers." (Qualified Opportunity, linkedin_post)');
    expect(t).toMatch(/not about the brief: no BriefStatus/);
  });

  it("keeps the old task shape when nothing new is passed", () => {
    const t = agentTask({ ...base, project: { name: "Launch", stage: "ideate" } });
    expect(t).toContain("Open project: Launch (stage: ideate)");
    expect(t).toContain("Already written: nothing yet");
    expect(t).not.toMatch(/not about the brief/);
  });
});
