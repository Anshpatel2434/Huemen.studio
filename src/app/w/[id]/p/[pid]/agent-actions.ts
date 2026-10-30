"use server";

/**
 * The agent panel ("Ask Huemen…"). Commands first: a request to draft, add a
 * pillar or capture an idea runs the project's real action directly, grounded
 * in the brief (INV-2) and the step gates (no drafting before pillars exist).
 * Anything else is a question, answered live in cards by the agent stream
 * (agent/stream, lib/agent-ui), whose buttons come back through runAgentAction.
 */
import { revalidatePath } from "next/cache";
import { actionProjectScope } from "@/lib/auth/workspace";
import { generateContent } from "@/lib/data/content";
import { parseAgentAction } from "@/lib/agent-ui/actions";
import { captureIdea, createPillar, listPillars } from "@/lib/data/planning";
import { getProject, unlockStage } from "@/lib/data/projects";
import { stageIndex } from "@/lib/projects/stages";
import { FORMATS } from "@/lib/content/formats";
import { scoreProject } from "@/lib/data/check";

export interface AgentReply {
  text: string;
  tasks: { label: string; detail?: string; href?: string }[];
  /** Not a command: the panel asks the agent stream instead (lib/agent-ui), which answers in cards. */
  stream?: boolean;
}

const FORMAT_WORDS: [RegExp, string][] = [
  [/hooks?/i, "hook_set"],
  [/carousel/i, "ig_carousel"],
  [/caption|instagram|\big\b/i, "ig_caption"],
  [/newsletter/i, "newsletter_section"],
  [/pitch|email/i, "pitch_email"],
  [/abstract|talk/i, "talk_abstract"],
  [/linkedin|post/i, "linkedin_post"],
];

const topicOf = (msg: string) => (msg.match(/\b(?:about|on)\s+(.+)$/i)?.[1] ?? "").replace(/[.?!]+$/, "").trim();

export async function askAgent(tenantId: string, projectId: string, message: string): Promise<AgentReply> {
  const scope = await actionProjectScope(tenantId, projectId);
  const project = await getProject(scope, projectId);
  const msg = message.trim();
  const base = `/w/${tenantId}/p/${projectId}`;
  const refresh = () => revalidatePath(base, "layout");

  if (/\b(write|draft|generate|create|make)\b/i.test(msg) && FORMAT_WORDS.some(([re]) => re.test(msg))) {
    const pillars = await listPillars(scope);
    if (!project || pillars.length === 0) {
      return { text: "There are no pillars yet. They are set up once for the whole workspace, in onboarding — generate them and I'll draft from them.", tasks: [{ label: "Open brief questions", href: `${base}/brief/questions` }] };
    }
    const format = FORMAT_WORDS.find(([re]) => re.test(msg))![1];
    const label = FORMATS.find((f) => f.key === format)!.label;
    const topic = topicOf(msg);
    const pillar = pillars.find((p) => msg.toLowerCase().includes(p.name.toLowerCase()));
    const id = await generateContent(scope, { format, topic, pillarId: pillar?.id ?? null });
    await scoreProject(scope).catch(() => undefined);
    await unlockStage(scope, "content");
    refresh();
    return {
      text: `Drafted two variants of a ${label.replace(/^(Newsletter|Pitch|Talk)/, (m) => m.toLowerCase())}${topic ? ` on “${topic}”` : ""}${pillar ? ` under ${pillar.name}` : ""}. Don't-words get flagged on the canvas, never auto-removed.`,
      tasks: [
        { label: "Brief loaded", detail: "Brand context injected" },
        { label: `${label} drafted`, detail: "2 variants saved to history", href: `${base}/content?item=${id}` },
      ],
    };
  }

  const pillarMatch = msg.match(/\b(?:add|create|new)\s+(?:a\s+)?pillar\s*(?:called|named|:)?\s*(.+)$/i);
  if (pillarMatch) {
    if (!project) {
      return { text: "Pillars are generated from the brief questions. Answer those and I can add more.", tasks: [{ label: "Open brief questions", href: `${base}/brief/questions` }] };
    }
    const name = pillarMatch[1].replace(/^["“]|["”.]$/g, "").trim();
    await createPillar(scope, name);
    refresh();
    return { text: `Added “${name}” as a pillar.`, tasks: [{ label: "Pillar map updated", detail: name, href: `${base}/pillars` }] };
  }

  const ideaMatch = msg.match(/^(?:idea|note|capture)\s*[:\-]\s*(.+)$/i);
  if (ideaMatch) {
    await captureIdea(scope, ideaMatch[1].trim());
    refresh();
    return { text: "Captured in the idea inbox and tagged to the closest pillar.", tasks: [{ label: "Idea captured", href: `${base}/ideas` }] };
  }

  // Everything that is not a command is a question: answered live, in cards.
  return { text: "", tasks: [], stream: true };
}

/**
 * A button in an agent answer was pressed. The browser's request is
 * re-validated against the allow-list (lib/agent-ui/actions) before anything
 * runs, and every action goes through the same data functions, scope and
 * step gates as the commands above. "ask" and "open" never reach here: the
 * panel handles them without a write.
 */
export async function runAgentAction(tenantId: string, projectId: string, raw: unknown): Promise<AgentReply> {
  const action = parseAgentAction(raw);
  if (!action || action.type === "ask" || action.type === "open") return { text: "That button no longer works. Ask again and I'll make a fresh one.", tasks: [] };
  const scope = await actionProjectScope(tenantId, projectId);
  const base = `/w/${tenantId}/p/${projectId}`;

  if (action.type === "draft_piece") {
    const pillars = await listPillars(scope);
    if (pillars.length === 0) {
      return { text: "There are no pillars yet. Generate them first and I'll draft from them.", tasks: [{ label: "Open brief questions", href: `${base}/brief/questions` }] };
    }
    const { format, topic } = action.params;
    const want = action.params.pillar?.toLowerCase();
    const pillar = want ? pillars.find((p) => p.name.toLowerCase() === want) : undefined;
    const label = FORMATS.find((f) => f.key === format)!.label;
    const id = await generateContent(scope, { format, topic, pillarId: pillar?.id ?? null });
    await scoreProject(scope).catch(() => undefined);
    await unlockStage(scope, "content");
    revalidatePath(base, "layout");
    return {
      text: `Drafted “${topic}”${pillar ? ` under ${pillar.name}` : ""}.`,
      tasks: [{ label: `${label} drafted`, detail: "2 variants saved to history", href: `${base}/content?item=${id}` }],
    };
  }

  if (action.type === "add_pillar") {
    const pillars = await listPillars(scope);
    if (pillars.some((p) => p.name.toLowerCase() === action.params.name.toLowerCase())) {
      return { text: `“${action.params.name}” is already one of your pillars.`, tasks: [{ label: "Open pillars", href: `${base}/pillars` }] };
    }
    await createPillar(scope, action.params.name, action.params.description);
    revalidatePath(base, "layout");
    return { text: `Added “${action.params.name}” as a pillar.`, tasks: [{ label: "Pillar map updated", detail: action.params.name, href: `${base}/pillars` }] };
  }

  await captureIdea(scope, action.params.text);
  revalidatePath(base, "layout");
  return { text: "Saved to the idea inbox.", tasks: [{ label: "Idea captured", href: `${base}/ideas` }] };
}
