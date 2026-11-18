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
import {
  ContentConflictError, ContentNotFoundError, generateContent, keepCurrentVersion, listContent, patchContent, recordRewrite,
  regenerateWithSteer, rewritePartOf,
} from "@/lib/data/content";
import { parseAgentAction } from "@/lib/agent-ui/actions";
import { pieceEdit, type PieceEdit } from "@/lib/agent-ui/edit";
import { namedCommand } from "@/lib/agent-ui/commands";
import { captureIdea, createPillar, listPillars } from "@/lib/data/planning";
import { getProject, unlockStage, type ProjectScope } from "@/lib/data/projects";
import { stageIndex } from "@/lib/projects/stages";
import { FORMATS } from "@/lib/content/formats";
import { isUuid } from "@/lib/content/ids";
import { scoreContentItem, scoreProject } from "@/lib/data/check";
import { userMessage } from "@/lib/ai/errors";
import { UnsupportedRewriteError } from "@/lib/voice/judge";

export interface AgentReply {
  text: string;
  tasks: { label: string; detail?: string; href?: string }[];
  /** Not a command: the panel asks the agent stream instead (lib/agent-ui), which answers in cards. */
  stream?: boolean;
  /** A draft to write live on the Content canvas (components/live-draft), beside the panel. */
  liveDraft?: { format: string; topic: string; pillarId: string | null };
  /** It did not go through (rate limit, cap, a model error): `text` says why; the panel keeps the message to send again. */
  failed?: boolean;
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

const PART_LABEL = { hook: "Hook", body: "Body", cta: "Call to action" } as const;

/** One line of a piece's copy, for a reply: whitespace folded, cut at a word. */
const clip = (s: string): string => {
  const t = s.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  return t.length > 140 ? `${t.slice(0, 137).replace(/\s+\S*$/, "")}…` : t;
};

/**
 * "Make the hook more contrarian" is about the piece on screen: it changes that
 * piece in place, the way the edit panel does (the part is rewritten in their
 * voice, saved through patchContent with the copy it started from as the stale
 * check, and kept in History). A whole-piece ask ("make it punchier", "shorter")
 * uses the same steer the piece's own steer buttons use. Nothing here creates an
 * item (F4, 2026-11-18).
 */
async function editOpenPiece(
  scope: ProjectScope,
  tenantId: string,
  projectId: string,
  itemId: string | null,
  msg: string,
  edit: PieceEdit,
): Promise<AgentReply> {
  const base = `/w/${tenantId}/p/${projectId}`;
  if (edit.part === "angle") {
    return {
      text: "The angle is set at Ideate for the whole piece, so I don't change it from here. Change it there, and the next draft follows it.",
      tasks: [{ label: "Open Ideate", href: `${base}/ideate` }],
    };
  }
  const item = isUuid(itemId) ? (await listContent(scope)).find((i) => i.id === itemId) : undefined;
  if (!item) {
    return {
      text: "Open the piece you want to change on the Content page, then ask again. I change the piece that is open, and don't start a new one for that.",
      tasks: [{ label: "Open Content", href: `${base}/content` }],
    };
  }
  const href = `${base}/content?item=${item.id}`;

  if (edit.part === "pillar") {
    const pillars = await listPillars(scope);
    const want = pillars.find((p) => msg.toLowerCase().includes(p.name.toLowerCase()));
    if (!want) {
      return { text: `Name the pillar to move it to. Your pillars are ${pillars.map((p) => p.name).join(", ")}.`, tasks: [] };
    }
    await patchContent(scope, item.id, { pillarId: want.id });
    revalidatePath(base, "layout");
    return {
      text: `Moved to ${want.name}${item.pillarName ? ` from ${item.pillarName}` : ""}. The copy is unchanged.`,
      tasks: [{ label: "Pillar changed", detail: want.name, href }],
    };
  }

  if (edit.part === "whole" || edit.part === "length") {
    try {
      await regenerateWithSteer(scope, item.id, msg);
    } catch (e) {
      // A steer that adds a claim the brand context does not back is not saved; the answer says what it adds.
      if (e instanceof UnsupportedRewriteError) return { text: e.message, tasks: [] };
      return { text: e instanceof ContentNotFoundError ? e.message : userMessage(e), tasks: [] };
    }
    await scoreContentItem(scope, item.id).catch(() => undefined);
    revalidatePath(base, "layout");
    const after = (await listContent(scope)).find((i) => i.id === item.id);
    return {
      text: `Rewrote the piece as asked. The hook is now “${clip(after?.hook ?? "")}”. The version before is in History.`,
      tasks: [{ label: "Piece rewritten", detail: "In place. History keeps the earlier version", href }],
    };
  }

  const field = edit.part;
  const before = item[field] ?? "";
  if (!before.trim()) {
    return {
      text: `That piece has no ${PART_LABEL[field].toLowerCase()} to change yet. Write it on the Content page first.`,
      tasks: [{ label: "Open Content", href }],
    };
  }
  let text: string | null;
  try {
    text = await rewritePartOf(scope, item.id, { part: field, text: before, instruction: msg.slice(0, 300) });
  } catch (e) {
    // A rewrite that adds a claim the brand context does not back is not saved (C2).
    if (e instanceof UnsupportedRewriteError) return { text: e.message, tasks: [] };
    throw e;
  }
  if (!text) return { text: "That piece is gone.", tasks: [] };
  // What is on the piece now is kept as a version first, then the rewrite lands
  // against the copy it started from: a typed edit made meanwhile is not overwritten.
  await keepCurrentVersion(scope, item.id);
  try {
    await patchContent(
      scope,
      item.id,
      { hook: field === "hook" ? text : undefined, body: field === "body" ? text : undefined, cta: field === "cta" ? text : undefined },
      { hook: field === "hook" ? before : undefined, body: field === "body" ? before : undefined, cta: field === "cta" ? before : undefined },
    );
  } catch (e) {
    if (e instanceof ContentConflictError) return { text: e.message, tasks: [] };
    throw e;
  }
  await recordRewrite(scope, item.id, msg, null);
  await scoreContentItem(scope, item.id).catch(() => undefined);
  revalidatePath(base, "layout");
  const which = `${FORMATS.find((f) => f.key === item.format)?.label ?? "Piece"}${item.topic ? ` on “${clip(item.topic)}”` : ""}`;
  return {
    text: `${PART_LABEL[field]} changed in place on your ${which}. Was “${clip(before)}”. Now “${clip(text)}”. The earlier version is in History.`,
    tasks: [{ label: `${PART_LABEL[field]} edited`, detail: "Saved on this piece", href }],
  };
}

export async function askAgent(tenantId: string, projectId: string, message: string, itemId?: string | null): Promise<AgentReply> {
  // No access throws as before (the panel then says it did not go through).
  const scope = await actionProjectScope(tenantId, projectId);
  try {
    return await runCommand(scope, tenantId, projectId, message, itemId);
  } catch (e) {
    // A model refusal, a rate limit or a cap is said plainly, with what to do
    // (2026-11-18: a daily limit came back as "That didn't go through").
    // The panel puts the message back in the box so it can be sent again.
    return { text: userMessage(e), tasks: [], failed: true };
  }
}

async function runCommand(scope: ProjectScope, tenantId: string, projectId: string, message: string, itemId?: string | null): Promise<AgentReply> {
  const project = await getProject(scope, projectId);
  const msg = message.trim();
  const base = `/w/${tenantId}/p/${projectId}`;
  const refresh = () => revalidatePath(base, "layout");

  // Named commands first: "Idea: ..." and "Add pillar ..." say what they are,
  // whatever words follow (2026-11-18: "Idea: ... before I cut it" was read as
  // "cut" the open piece, and the piece was rewritten).
  const command = namedCommand(msg);
  if (command?.type === "idea") {
    await captureIdea(scope, command.text);
    refresh();
    return { text: "Captured in the idea inbox, tagged to a pillar where its words match one.", tasks: [{ label: "Idea captured", href: `/w/${tenantId}/plan/ideas` }] };
  }
  if (command?.type === "pillar") {
    if (!project) {
      return { text: "Pillars are generated from the brief questions. Answer those and I can add more.", tasks: [{ label: "Open brief questions", href: `/w/${tenantId}/brand/questions` }] };
    }
    const name = command.name;
    await createPillar(scope, name);
    refresh();
    return { text: `Added “${name}” as a pillar.`, tasks: [{ label: "Pillar map updated", detail: name, href: `/w/${tenantId}/brand/pillars` }] };
  }

  // A change to the open piece is an edit in place, checked before the
  // "write/draft" command below, which would otherwise make a new item.
  const edit = pieceEdit(msg);
  if (edit) return editOpenPiece(scope, tenantId, projectId, itemId ?? null, msg, edit);

  if (/\b(write|draft|generate|create|make)\b/i.test(msg) && FORMAT_WORDS.some(([re]) => re.test(msg))) {
    const pillars = await listPillars(scope);
    if (!project || pillars.length === 0) {
      return { text: "There are no pillars yet. They are set up once for the whole workspace, in onboarding — generate them and I'll draft from them.", tasks: [{ label: "Open brief questions", href: `/w/${tenantId}/brand/questions` }] };
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

  // The draft itself is written live on the Content canvas, beside the panel
  // (components/live-draft, through content/stream, which saves and scores it).
  // Here: the step gate, the Content step opened, and the pillar named by the
  // card turned into this workspace's pillar.
  if (action.type === "draft_piece") {
    const pillars = await listPillars(scope);
    if (pillars.length === 0) {
      return { text: "There are no pillars yet. Generate them first and I'll draft from them.", tasks: [{ label: "Open brief questions", href: `/w/${tenantId}/brand/questions` }] };
    }
    try {
      await unlockStage(scope, "content");
    } catch {
      return { text: "This project isn't ready to draft yet. Say what it's about in Ideate first.", tasks: [{ label: "Open Ideate", href: `${base}/ideate` }] };
    }
    const { format, topic } = action.params;
    const want = action.params.pillar?.toLowerCase();
    const pillar = want ? pillars.find((p) => p.name.toLowerCase() === want) : undefined;
    const label = FORMATS.find((f) => f.key === format)!.label;
    revalidatePath(base, "layout");
    return {
      text: `Writing “${topic}” on the canvas, in your voice${pillar ? `, under ${pillar.name}` : ""}.`,
      tasks: [{ label: `${label}, two versions`, detail: "Saved to the project when it finishes" }],
      liveDraft: { format, topic, pillarId: pillar?.id ?? null },
    };
  }

  if (action.type === "add_pillar") {
    const pillars = await listPillars(scope);
    if (pillars.some((p) => p.name.toLowerCase() === action.params.name.toLowerCase())) {
      return { text: `“${action.params.name}” is already one of your pillars.`, tasks: [{ label: "Open pillars", href: `/w/${tenantId}/brand/pillars` }] };
    }
    await createPillar(scope, action.params.name, action.params.description);
    revalidatePath(base, "layout");
    return { text: `Added “${action.params.name}” as a pillar.`, tasks: [{ label: "Pillar map updated", detail: action.params.name, href: `/w/${tenantId}/brand/pillars` }] };
  }

  await captureIdea(scope, action.params.text);
  revalidatePath(base, "layout");
  return { text: "Saved to the idea inbox.", tasks: [{ label: "Idea captured", href: `/w/${tenantId}/plan/ideas` }] };
}
