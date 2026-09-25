"use server";

/**
 * The agent panel ("Ask Huemen…"). A command router over the project's real
 * actions — every one grounded in the project's brief (INV-2) — not a
 * free-form chatbot. It respects the step gates: it won't draft content before
 * pillars exist, and says so.
 */
import { revalidatePath } from "next/cache";
import { actionProjectScope } from "@/lib/auth/workspace";
import { loadBrandContext } from "@/lib/context/context-loader";
import { generateContent } from "@/lib/data/content";
import { captureIdea, createPillar, listPillars } from "@/lib/data/planning";
import { getProject, unlockStage } from "@/lib/data/projects";
import { stageIndex } from "@/lib/projects/stages";
import { FORMATS } from "@/lib/content/formats";

export interface AgentReply {
  text: string;
  tasks: { label: string; detail?: string; href?: string }[];
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

  if (/\b(brief|foundation|missing|complete|ready|next)\b/i.test(msg)) {
    const ctx = await loadBrandContext(scope);
    const next = project?.stage === "ideate" ? "Next: pick the angle for this piece, then draft it." : "";
    const text = ctx.degraded
      ? `The brief is ${ctx.completeness}% complete, so drafts will read generic. Fix these first: ${ctx.warnings.slice(0, 3).join(" ")} ${next}`
      : `The brief is ${ctx.completeness}% complete.${ctx.warnings.length ? ` Worth tightening: ${ctx.warnings.slice(0, 2).join(" ")}` : ""} ${next}`;
    return { text: text.trim(), tasks: [{ label: "Open the brief", href: `${base}/brief` }] };
  }

  return {
    text: "I work from this project's brief. Try “Write a LinkedIn post about pricing”, “Add pillar Behind the scenes”, “Idea: my first client story”, or “What's missing from my brief?”",
    tasks: [],
  };
}
