"use server";

/**
 * Pictures and comments on the visual board. Every action resolves the
 * project scope first (session, workspace access, project in workspace), and
 * the data layer checks every id against the project again (RLS under it).
 *
 * Slow work (drawing a picture, redrawing an area) is queued (lib/jobs) and
 * returns a job id the board watches; comments on text or design are applied
 * in the request, like ask-for-a-change.
 */
import { revalidatePath } from "next/cache";
import { actionProjectScope } from "@/lib/auth/workspace";
import { enqueueJob, retryJob, startWorker } from "@/lib/jobs";
import { ARTBOARDS, type ArtboardKind, type Design, type PictureMode } from "@/lib/visual/design";
import { ContentConflictError, listContent } from "@/lib/data/content";
import { designOf, PictureError, removePicture, selectPictureVersion } from "@/lib/data/pictures";
import { addComment, applyTemplateComment, CommentError, dismissComment, failedComment, finishComment, type VisualComment } from "@/lib/data/visual-comments";
import { approveAgain, revertCopy } from "@/lib/data/visual-copy";
import { recordOpener } from "@/lib/data/voice-pack";
import { learnFromApproval } from "@/lib/data/learning";
import { getSession } from "@/lib/auth";
import { userMessage } from "@/lib/ai/errors";
import { cleanBox } from "@/lib/visual/region";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const artboardOf = (v: string): ArtboardKind | null => (ARTBOARDS.includes(v as ArtboardKind) ? (v as ArtboardKind) : null);
const say = (e: unknown) => (e instanceof PictureError || e instanceof CommentError ? e.message : userMessage(e));

/** Draw a new picture for one visual (or redraw it in the other mode). Queued; returns the job to watch. */
export async function startPictureAction(
  tenantId: string, projectId: string, contentItemId: string, artboard: string, mode: PictureMode,
): Promise<Result<{ jobId: string }>> {
  const scope = await actionProjectScope(tenantId, projectId);
  const kind = artboardOf(artboard);
  if (!kind) return { ok: false, error: "That visual doesn't take a picture." };
  if (!(await designOf(scope, contentItemId))) return { ok: false, error: "Make the visuals first; a picture goes on one of them." };
  const jobId = await enqueueJob(
    scope, "picture_generate",
    { projectId, contentItemId, artboard: kind, mode: mode === "with_text" ? "with_text" : "live_text" },
    { label: "Drawing a picture", maxAttempts: 3 },
  );
  startWorker();
  return { ok: true, jobId };
}

/** Show a given version of a visual's picture (undo/redo), or take the picture off (null). */
export async function setPictureAction(
  tenantId: string, projectId: string, contentItemId: string, artboard: string, pictureId: string | null,
): Promise<Result<object>> {
  const scope = await actionProjectScope(tenantId, projectId);
  const kind = artboardOf(artboard);
  if (!kind) return { ok: false, error: "That visual doesn't take a picture." };
  try {
    if (pictureId === null) await removePicture(scope, contentItemId, kind);
    else if (!(await selectPictureVersion(scope, contentItemId, kind, pictureId))) return { ok: false, error: "That version isn't there any more." };
  } catch (e) {
    return { ok: false, error: say(e) };
  }
  revalidatePath(`/w/${tenantId}/p/${projectId}/visual`);
  return { ok: true };
}

/**
 * A comment pinned on a box of a visual. Picture comments are queued (only
 * that box is redrawn); text and design comments are applied now and come
 * back with what changed, so the board can offer undo.
 */
export async function addCommentAction(
  tenantId: string, projectId: string,
  input: { visualId: string; target: string; box: { x: number; y: number; w: number; h: number }; note: string; area?: { x: number; y: number; w: number; h: number } | null },
): Promise<Result<{ comment: VisualComment; jobId: string | null; after: { hook: string; body: string; cta: string; design: Design | null } | null }>> {
  const scope = await actionProjectScope(tenantId, projectId);
  let comment: VisualComment;
  try {
    comment = await addComment(scope, {
      visualId: String(input?.visualId ?? ""), target: String(input?.target ?? ""), box: input?.box ?? {}, note: String(input?.note ?? ""),
    });
  } catch (e) {
    return { ok: false, error: say(e) };
  }
  if (comment.target === "picture") {
    const area = cleanBox(input?.area ?? null);
    const jobId = await enqueueJob(scope, "picture_edit", { projectId, commentId: comment.id, ...(area ? { area } : {}) }, { label: "Changing the picture", maxAttempts: 3 });
    await finishComment(scope, comment.id, { status: "working", jobId });
    startWorker();
    return { ok: true, comment: { ...comment, status: "working", jobId }, jobId, after: null };
  }
  const done = await applyTemplateComment(scope, comment);
  revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");
  // What the piece and its design are now, so the board can offer undo and redo.
  const item = (await listContent(scope)).find((i) => i.id === comment.contentItemId);
  const after = item ? { hook: item.hook, body: item.body, cta: item.cta, design: await designOf(scope, comment.contentItemId) } : null;
  return { ok: true, comment: done, jobId: null, after };
}

/**
 * Try again on a comment that didn't go through: the same comment (same box,
 * same words) is run again. A text or design comment is applied now, as when
 * it was sent; a picture comment's job goes back in the queue (or a new one
 * is queued when the old one is gone).
 */
export async function retryCommentAction(
  tenantId: string, projectId: string, commentId: string,
): Promise<Result<{ comment: VisualComment; jobId: string | null; after: { hook: string; body: string; cta: string; design: Design | null } | null }>> {
  const scope = await actionProjectScope(tenantId, projectId);
  let comment: VisualComment;
  try {
    comment = await failedComment(scope, String(commentId ?? ""));
  } catch (e) {
    return { ok: false, error: say(e) };
  }
  if (comment.target === "picture") {
    const again = comment.jobId ? await retryJob(scope, comment.jobId) : false;
    const jobId = again && comment.jobId
      ? comment.jobId
      : await enqueueJob(scope, "picture_edit", { projectId, commentId: comment.id }, { label: "Changing the picture", maxAttempts: 3 });
    await finishComment(scope, comment.id, { status: "working", result: "Trying again.", jobId });
    startWorker();
    return { ok: true, comment: { ...comment, status: "working", result: "Trying again.", jobId }, jobId, after: null };
  }
  const done = await applyTemplateComment(scope, comment);
  revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");
  const item = (await listContent(scope)).find((i) => i.id === comment.contentItemId);
  const after = item ? { hook: item.hook, body: item.body, cta: item.cta, design: await designOf(scope, comment.contentItemId) } : null;
  return { ok: true, comment: done, jobId: null, after };
}

/**
 * Undo of a copy edit made on this board: the words go back, and so does the
 * piece's status when the edit was what changed it (lib/data/visual-copy).
 * Same stale-canvas rule as any edit: `base` is what the canvas shows now.
 */
export async function revertCopyAction(
  tenantId: string, projectId: string, itemId: string,
  patch: { hook?: string; body?: string; cta?: string },
  base: { hook?: string; body?: string; cta?: string } | null,
  status: string | null,
): Promise<{ conflict: string } | void> {
  const scope = await actionProjectScope(tenantId, projectId);
  try {
    await revertCopy(scope, itemId, patch, base, status);
  } catch (e) {
    if (!(e instanceof ContentConflictError)) throw e;
    revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");
    return { conflict: e.message };
  }
  revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");
}

/**
 * Approve a piece again after an edit on a visual moved it back to edited.
 * Same side effects as approving on Content: the opening joins the recent
 * openers and the voice learns from the approval (best effort).
 */
export async function approveAgainAction(tenantId: string, projectId: string, itemId: string): Promise<boolean> {
  const scope = await actionProjectScope(tenantId, projectId);
  const done = await approveAgain(scope, itemId);
  if (!done) return false;
  if (done.hook.trim()) await recordOpener(scope, done.hook).catch(() => undefined);
  const session = await getSession();
  if (session) await learnFromApproval(scope, { userId: session.userId, role: session.role }, itemId).catch(() => null);
  revalidatePath(`/w/${tenantId}/p/${projectId}`, "layout");
  return true;
}

/** Clear a finished pin from the board. */
export async function dismissCommentAction(tenantId: string, projectId: string, commentId: string): Promise<boolean> {
  const scope = await actionProjectScope(tenantId, projectId);
  const ok = await dismissComment(scope, commentId);
  revalidatePath(`/w/${tenantId}/p/${projectId}/visual`);
  return ok;
}
