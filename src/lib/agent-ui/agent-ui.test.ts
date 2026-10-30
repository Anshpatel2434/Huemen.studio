import { describe, it, expect } from "vitest";
import { buildBrandContext } from "@/lib/context/context-builder";
import { assemblePrompt } from "@/lib/ai/prompt";
import { mockAgentAnswer } from "./mock";
import { AGENT_CONTRACT, agentSpec, agentTask, answerErrors } from "./prompt";
import { parseAgentAction } from "./actions";

const withPillars = buildBrandContext({
  brandProfile: {
    niche: "Personal branding for B2B founders",
    positioningStatement: "The brand professor for solo experts.",
    pillars: [
      { name: "Contrarian takes", description: "Where I disagree with the playbook" },
      { name: "Proof and case stories", description: "Client results, told plainly" },
      { name: "Behind the work", description: null },
    ],
  },
});
const thin = buildBrandContext({});

const task = (question: string) => agentTask({ question, earlier: [], project: { name: "Launch", stage: "ideate" }, completeness: 40, warnings: ["Add voice samples."] });

const QUESTIONS = ["Plan my week", "Give me hooks for a post on pricing", "Suggest a new pillar", "What should I write next?", "What's missing from my brief?"];

describe("agent answers (OpenUI)", () => {
  for (const ctx of [withPillars, thin]) {
    for (const question of QUESTIONS) {
      it(`stand-in answer parses cleanly: "${question}" (${ctx === thin ? "thin brief" : "with pillars"})`, () => {
        const out = answerErrors(mockAgentAnswer(ctx, task(question)));
        expect(out.hasRoot).toBe(true);
        expect(out.errors).toEqual([]);
        expect(out.unresolved).toEqual([]);
      });
    }
  }

  it("both prompt examples parse cleanly", () => {
    const examples = agentSpec().split("## Examples")[1].split("## Important Rules")[0];
    const programs = examples.split(/\n\s*\n/).map((s) => s.trim()).filter((s) => s.startsWith("root ="));
    expect(programs).toHaveLength(2);
    for (const program of programs) {
      const out = answerErrors(program);
      expect(out.errors).toEqual([]);
      expect(out.unresolved).toEqual([]);
    }
  });

  it("the panel draws exactly the language the model is told about", async () => {
    const { agentLibrary } = await import("./library");
    const { agentSpecLibrary } = await import("./spec");
    expect(Object.keys(agentLibrary.components).sort()).toEqual(Object.keys(agentSpecLibrary.components).sort());
    expect(agentLibrary.toJSONSchema()).toEqual(agentSpecLibrary.toJSONSchema());
  });

  it("the spec rides in the cached system part, the task in the user part", () => {
    const p = assemblePrompt("TEMPLATE", withPillars, task("Plan my week"), { templateKey: "agent_answer", contract: AGENT_CONTRACT, systemContract: agentSpec() });
    expect(p.system).toContain("<output_language>");
    expect(p.system).toContain("PlanSlot(");
    expect(p.system.indexOf("<output_language>")).toBeLessThan(p.system.indexOf("<brand_context>"));
    expect(p.user).toContain("Question: Plan my week");
    expect(p.user).not.toContain("PlanSlot(");
  });
});

describe("agent button actions are allow-listed", () => {
  it("accepts the five known actions", () => {
    expect(parseAgentAction({ type: "draft_piece", params: { format: "linkedin_post", topic: "Pricing", pillar: "Proof" } })).toBeTruthy();
    expect(parseAgentAction({ type: "add_pillar", params: { name: "Behind the work" } })).toBeTruthy();
    expect(parseAgentAction({ type: "capture_idea", params: { text: "A hook" } })).toBeTruthy();
    expect(parseAgentAction({ type: "open", params: { page: "setup" } })).toBeTruthy();
    expect(parseAgentAction({ type: "ask", params: { text: "Plan my week" } })).toBeTruthy();
  });

  it("refuses anything else", () => {
    expect(parseAgentAction({ type: "open_url", params: { url: "https://example.com" } })).toBeNull();
    expect(parseAgentAction({ type: "open", params: { page: "../../settings" } })).toBeNull();
    expect(parseAgentAction({ type: "draft_piece", params: { format: "press_release", topic: "x" } })).toBeNull();
    expect(parseAgentAction({ type: "draft_piece", params: { format: "linkedin_post", topic: "x".repeat(2000) } })).toBeNull();
    expect(parseAgentAction({ type: "add_pillar", params: { name: "" } })).toBeNull();
    expect(parseAgentAction(null)).toBeNull();
  });
});
