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
import { ANGLES, angleLine } from "@/lib/content/angles";

export const AGENT_TEMPLATE_KEY = "agent_answer";

const RULES = [
  "Answer ONLY in OpenUI Lang. No prose before or after it, no code fences, no markdown.",
  "Ground every line in the brand context and the project facts in the task. Never invent a fact, client, number or credential.",
  "Use the person's pillars by their exact names. Use format keys exactly as listed.",
  "The answer shows in a narrow side panel: keep it short. At most six blocks, at most five IdeaCards or PlanSlots.",
  "What to write next: IdeaCards. A plan for the week: WeekPlan with PlanSlots. How the brief or project stands: BriefStatus(), placed where the status goes, with a Para that says what it means for drafts. BriefStatus draws the brief's score and open items itself, so never write a score, a percentage or a done or not-done list. Opening lines: HookOptions. New pillar ideas: PillarCards with suggested true.",
  // 2026-11-18 agent test: "Plan my week" and "What should I write next?" came back as the open post's production steps, all on one pillar, with the brief score on every answer.
  "What to write next and a week plan are NEW posts: never a post listed under \"Already written\", and never the open project's topic when it already has a piece. Spread them across the pillars, starting with the pillars that have the fewest pieces; use at least three different pillars when there are three or more.",
  "Every IdeaCard and PlanSlot is one separate post a reader would see, with its own topic. Never a production step such as drafting, designing, reviewing, editing, publishing or scheduling a post.",
  "BriefStatus only when the question asks how the brief, the voice or the project stands. Never add it to other answers.",
  // Pictures: the picture brief (lib/data/pictures) decides what is drawn, so the answer never designs one.
  "Pictures: when asked what a picture should show, do not describe people, faces, a founder, hands, icons, logos or words in the picture. A picture is drawn from its picture brief, which forbids people, faces, hands, logos and text in the image. Say that the brief draws it, and point to the Visual board to draw it.",
  // Angles: asked for angles, the answer is angles, not post ideas (lib/content/angles).
  `Angles: when asked for angles, or for sharper ones, answer with the angles themselves, never with post ideas. One IdeaCard per angle: its title is the label alone, in the words below without the quotes, and its why is the ask in brackets, as listed. Sharper means the same labels with an ask fitted to this brand, never a new label. IdeaCard format is linkedin_post unless the ask names another format key. The angles: ${ANGLES.map((a) => `"${a}" ${angleLine(a).replace(`Angle: ${a} `, "")}`).join(" ")}`,
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
    'root = Answer([status, next])',
    'status = BriefStatus()',
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
  project: { name: string; stage: string; pieces?: number } | null;
  completeness: number;
  warnings: string[];
  /** Every pillar with what it already has, so suggestions spread to the thin ones. */
  pillars?: { name: string; pieces: number; ideas: number; slots: number }[];
  /** Posts already written in the workspace (newest first), so they are not suggested again. */
  written?: { hook: string; pillar: string | null; format: string }[];
  /** False when the question is not about the brief: the answer then leaves the brief out. Unset keeps the old behaviour. */
  aboutBrief?: boolean;
}): string {
  const pillars = input.pillars ?? [];
  const written = (input.written ?? []).filter((w) => w.hook.trim());
  return [
    `Question: ${input.question.trim()}`,
    input.earlier.length ? `Asked earlier in this conversation:\n${input.earlier.map((q) => `- ${q}`).join("\n")}` : "",
    input.project
      ? `Open project: ${input.project.name} (stage: ${input.project.stage}${input.project.pieces !== undefined ? `, ${input.project.pieces} ${input.project.pieces === 1 ? "piece" : "pieces"} written` : ""})`
      : "Project: none open",
    pillars.length
      ? `Pillars and what each already has:\n${pillars.map((p) => `- ${p.name}: ${p.pieces} ${p.pieces === 1 ? "piece" : "pieces"}, ${p.ideas} ${p.ideas === 1 ? "idea" : "ideas"}, ${p.slots} calendar ${p.slots === 1 ? "slot" : "slots"}`).join("\n")}`
      : "",
    written.length
      ? `Already written (never suggest these again as new posts):\n${written.map((w) => `- "${w.hook.trim().slice(0, 140)}" (${w.pillar ?? "no pillar"}, ${w.format})`).join("\n")}`
      : "Already written: nothing yet",
    input.aboutBrief === false
      ? "This question is not about the brief: no BriefStatus, and no sentence about the brief's score or gaps. Answer the question only. Show each post once: a WeekPlan, or IdeaCards, not both."
      : "",
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
