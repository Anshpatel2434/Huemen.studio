/**
 * The agent's answer language: which components exist, what each is for, and
 * the props each takes. React-free (@openuidev/lang-core), so the stream route
 * can build the prompt and parse answers on the server, where React's client
 * APIs do not exist. library.tsx gives each of these a renderer; it cannot add
 * or reshape one, so what the model is told and what the panel draws are the
 * same list by construction.
 *
 * Safety is in the shape, not in the prompt:
 *   - Every component is Huemen's own. There is no raw HTML, no iframe, and no
 *     image or link to anywhere outside the app.
 *   - The model never writes an action. A button's action is fixed by its
 *     component ("Draft this" drafts, "Open" opens one of PAGES); the model
 *     only fills in props, and the server re-validates every action
 *     (actions.ts, agent-actions: runAgentAction) before anything runs.
 */
import { createLibrary, defineComponent, tagSchemaId } from "@openuidev/lang-core";
import { z } from "zod";
import { FORMATS } from "@/lib/content/formats";

// ---- Shared schema pieces -------------------------------------------------------

const node = z.any();
tagSchemaId(node, "Node");
const children = z.array(node);

// Left untagged so the prompt prints the allowed values inline.
const format = z.enum(FORMATS.map((f) => f.key) as [string, ...string[]]);

/** Pages the agent may send the person to, inside the current project or workspace. */
export const PAGES = {
  brief: { label: "Brief", path: "brief", scope: "project" },
  brief_questions: { label: "Brief questions", path: "brief/questions", scope: "project" },
  pillars: { label: "Pillars", path: "pillars", scope: "project" },
  ideas: { label: "Idea inbox", path: "ideas", scope: "project" },
  ideate: { label: "Ideate", path: "ideate", scope: "project" },
  content: { label: "Content", path: "content", scope: "project" },
  visual: { label: "Visual", path: "visual", scope: "project" },
  calendar: { label: "Calendar", path: "calendar", scope: "project" },
  check: { label: "Check", path: "check", scope: "workspace" },
  voice: { label: "Voice", path: "brand/voice", scope: "workspace" },
  setup: { label: "Getting started", path: "setup", scope: "workspace" },
} as const;
export type PageKey = keyof typeof PAGES;
export const PAGE_KEYS = Object.keys(PAGES) as [PageKey, ...PageKey[]];
const page = z.enum(PAGE_KEYS);

/** What a component's button asks the panel to do. Validated again on the server. */
export type AgentAction =
  | { type: "ask"; params: { text: string } }
  | { type: "open"; params: { page: PageKey } }
  | { type: "draft_piece"; params: { format: string; topic: string; pillar?: string } }
  | { type: "add_pillar"; params: { name: string; description?: string } }
  | { type: "capture_idea"; params: { text: string } };

// ---- Props ------------------------------------------------------------------------

export const PROPS = {
  Answer: z.object({ children }),
  Heading: z.object({ text: z.string() }),
  Para: z.object({ text: z.string() }),
  Bullets: z.object({ items: z.array(z.string()) }),
  Note: z.object({ text: z.string(), tone: z.enum(["tip", "warn"]).optional() }),
  ScoreBar: z.object({ label: z.string(), score: z.number(), note: z.string().optional() }),
  Checklist: z.object({ children }),
  CheckItem: z.object({ label: z.string(), done: z.boolean(), page: page.optional() }),
  IdeaCard: z.object({ title: z.string(), format, pillar: z.string().optional(), why: z.string().optional() }),
  WeekPlan: z.object({ children }),
  PlanSlot: z.object({ day: z.string(), title: z.string(), format, pillar: z.string().optional() }),
  PillarCard: z.object({ name: z.string(), description: z.string().optional(), suggested: z.boolean().optional() }),
  HookOptions: z.object({ hooks: z.array(z.string()) }),
  OpenPage: z.object({ label: z.string(), page }),
  FollowUps: z.object({ questions: z.array(z.string()) }),
};
export type ComponentName = keyof typeof PROPS;
export type PropsOf<N extends ComponentName> = z.infer<(typeof PROPS)[N]>;

export const DESCRIPTIONS: Record<ComponentName, string> = {
  Answer: "The whole answer: a column of blocks. Always the root.",
  Heading: "A short section title, sentence case.",
  Para: "One short paragraph of plain text. No markdown.",
  Bullets: "A short list of plain-text points.",
  Note: 'A highlighted line: "tip" for advice, "warn" for something to fix first.',
  ScoreBar: "A 0-100 score with a label and an optional one-line note, e.g. brief completeness.",
  Checklist: "A list of CheckItem rows.",
  CheckItem: "One row of a Checklist: done or still to do, with an optional page that fixes it.",
  IdeaCard: "A post idea the person can draft in one click. title is the topic in their words; pillar must be one of their pillars.",
  WeekPlan: "A posting plan: a list of PlanSlot rows in order.",
  PlanSlot: 'One planned post: day (e.g. "Mon"), the topic, its format and pillar. Has its own Draft button.',
  PillarCard: "A content pillar. Set suggested true for a NEW pillar the person does not have yet; it gets an Add button.",
  HookOptions: "Alternative opening lines. Each can be saved to the idea inbox.",
  OpenPage: "A button that opens one page of the studio.",
  FollowUps: "Two or three short questions the person might ask next, in their words. Clicking one asks it.",
};

export const COMPONENT_GROUPS = [
  { name: "Text", components: ["Heading", "Para", "Bullets", "Note"] },
  { name: "Status", components: ["ScoreBar", "Checklist", "CheckItem"] },
  { name: "Planning", components: ["IdeaCard", "WeekPlan", "PlanSlot", "PillarCard", "HookOptions"] },
  { name: "Next steps", components: ["OpenPage", "FollowUps"] },
];

export const COMPONENT_NAMES = Object.keys(PROPS) as ComponentName[];

/** The language without renderers: what the server prompts with and parses against. */
export const agentSpecLibrary = createLibrary({
  root: "Answer",
  components: COMPONENT_NAMES.map((name) => defineComponent({ name, description: DESCRIPTIONS[name], props: PROPS[name], component: null })),
  componentGroups: COMPONENT_GROUPS,
});
