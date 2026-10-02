"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionScope } from "@/lib/auth/workspace";
import { proposeTopics, startPiece } from "@/lib/data/create";
import { markIdeaStarted } from "@/lib/data/planning";
import { userMessage } from "@/lib/ai/errors";

/**
 * Start a piece from a proposal, an idea, a calendar slot or a typed topic.
 * Every route lands on the same place: a new project, open at Ideate.
 */
export async function startPieceAction(fd: FormData): Promise<void> {
  const tenantId = String(fd.get("tenantId") ?? "");
  const scope = await actionScope(tenantId);
  const ideaId = String(fd.get("ideaId") ?? "").trim() || null;
  const projectId = await startPiece(scope, {
    topic: String(fd.get("topic") ?? ""),
    format: String(fd.get("format") ?? "").trim() || null,
    pillarName: String(fd.get("pillar") ?? "").trim() || null,
    ideaId,
  });
  if (ideaId) await markIdeaStarted(scope, ideaId);
  revalidatePath(`/w/${tenantId}`, "layout");
  redirect(`/w/${tenantId}/p/${projectId}/ideate`);
}

/** "Suggest others": the one place Create spends a model call on purpose. */
export async function suggestOthersAction(tenantId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const scope = await actionScope(tenantId);
  try {
    await proposeTopics(scope, { force: true });
    revalidatePath(`/w/${tenantId}/create`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userMessage(e) };
  }
}
