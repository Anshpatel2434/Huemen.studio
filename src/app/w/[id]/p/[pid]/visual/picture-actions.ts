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
import { enqueueJob, startWorker } from "@/lib/jobs";
import { ARTBOARDS, type ArtboardKind, type Design, type PictureMode } from "@/lib/visual/design";
import { listContent } from "@/lib/data/content";
import { designOf, PictureError, removePicture, selectPictureVersion } from "@/lib/data/pictures";
import { addComment, applyTemplateComment, CommentError, dismissComment, finishComment, type VisualComment } from "@/lib/data/visual-comments";
import { userMessage } from "@/lib/ai/errors";

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
  input: { visualId: string; target: string; box: { x: number; y: number; w: number; h: number }; note: string },
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
    const jobId = await enqueueJob(scope, "picture_edit", { projectId, commentId: comment.id }, { label: "Changing the picture", maxAttempts: 3 });
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

/** Clear a finished pin from the board. */
export async function dismissCommentAction(tenantId: string, projectId: string, commentId: string): Promise<boolean> {
  const scope = await actionProjectScope(tenantId, projectId);
  const ok = await dismissComment(scope, commentId);
  revalidatePath(`/w/${tenantId}/p/${projectId}/visual`);
  return ok;
}
