/**
 * The agent's output contract: the OpenUI Lang spec for agentLibrary, plus the
 * rules for using it here. Code-owned like every contract (lib/ai/prompt): the
 * admin-editable template ("agent_answer") says how to think, this says what
 * shape to hand back, and the parser that reads it is code.
 *
 * The spec goes in the SYSTEM part, after the template and before the brand
 * context: it never changes per request, so it is cached with them.
 */
import { createParser } from "@openuidev/lang-core";
import { agentSpecLibrary as agentLibrary } from "./spec";

export const AGENT_TEMPLATE_KEY = "agent_answer";

const RULES = [
  "Answer ONLY in OpenUI Lang. No prose before or after it, no code fences, no markdown.",
  "Ground every line in the brand context and the project facts in the task. Never invent a fact, client, number or credential.",
  "Use the person's pillars by their exact names. Use format keys exactly as listed.",
  "The answer shows in a narrow side panel: keep it short. At most six blocks, at most five IdeaCards or PlanSlots.",
  "What to write next: IdeaCards. A plan for the week: WeekPlan with PlanSlots. How the brief or project stands: ScoreBar and a Checklist with a page to fix each open item. Opening lines: HookOptions. New pillar ideas: PillarCards with suggested true.",
  "Never say you did something. Buttons do things; say what each one will do only if it is not obvious.",
  "Plain, direct words in British English. No emojis, no exclamation marks, never the word AI.",
  "End with FollowUps when there is an obvious next question.",
];

const EXAMPLES = [
  [
    'root = Answer([h, p, i1, i2, more])',
    'h = Heading("Two posts for this week")',
    'p = Para("Your proof pillar has nothing scheduled, so one of these leans on it.")',
    'i1 = IdeaCard("The client who almost fired me in week two", "linkedin_post", "Proof and case stories", "A story only you can tell.")',
    'i2 = IdeaCard("Why I stopped writing proposals", "linkedin_post", "Contrarian takes")',
    'more = FollowUps(["Plan the whole week", "Give me hooks for the first one"])',
  ].join("\n"),
  [
    'root = Answer([score, list, next])',
    'score = ScoreBar("Brief", 62, "Drafts will read generic until the gaps below are filled.")',
    'list = Checklist([c1, c2, c3])',
    'c1 = CheckItem("Voice samples added", true)',
    'c2 = CheckItem("Beliefs to argue from", false, "setup")',
    'c3 = CheckItem("Proof with a source", false, "setup")',
    'next = OpenPage("Open Getting started", "setup")',
  ].join("\n"),
];

let _spec: string | null = null;

/** The spec and rules, built once per server process (the library never changes at runtime). */
export function agentSpec(): string {
  _spec ??= agentLibrary.prompt({ preamble: "", additionalRules: RULES, examples: EXAMPLES }).trim();
  return _spec;
}

/** The task: the question, plus the project facts the brand context does not carry. */
export function agentTask(input: {
  question: string;
  earlier: string[];
  project: { name: string; stage: string } | null;
  completeness: number;
  warnings: string[];
}): string {
  return [
    `Question: ${input.question.trim()}`,
    input.earlier.length ? `Asked earlier in this conversation:\n${input.earlier.map((q) => `- ${q}`).join("\n")}` : "",
    input.project ? `Project: ${input.project.name} (stage: ${input.project.stage})` : "Project: none open",
    `Brief completeness: ${input.completeness}%`,
    input.warnings.length ? `Gaps in the brief:\n${input.warnings.map((w) => `- ${w}`).join("\n")}` : "Gaps in the brief: none",
  ]
    .filter(Boolean)
    .join("\n");
}

export const AGENT_CONTRACT = "Reply with one OpenUI Lang program as the system prompt describes. Start with the root line.";

/** Structural errors in a finished answer (empty when it renders cleanly). */
export function answerErrors(text: string) {
  const result = createParser(agentLibrary.toJSONSchema(), agentLibrary.root).parse(text);
  return { errors: result.meta.errors ?? [], unresolved: result.meta.unresolved ?? [], hasRoot: !!result.root };
}
