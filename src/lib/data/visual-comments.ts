/**
 * "Change this part": a comment pinned on a box of a visual.
 *
 * The board says what the box is on (the element under it: the picture, the
 * headline, the body, the call to action, the logo or the background). The
 * comment is kept, then routed:
 *
 *   picture     a job (lib/jobs picture_edit) redraws only that box of the
 *               picture (lib/data/pictures redrawArea)
 *   headline, body, cta
 *               the existing ask-for-a-change rewrite (rewritePartOf), saved to
 *               the piece like any asked change
 *   logo, background
 *               Claude turns the comment into design settings (task
 *               design_change), applied like a Design panel change
 *
 * Every comment ends 'applied' with what changed, or 'failed' with why, so the
 * pin on the board always says what happened.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import { runTask } from "@/lib/ai";
import { designChange } from "@/lib/ai/tasks";
import { userMessage } from "@/lib/ai/errors";
import { loadBrandContext } from "@/lib/context/context-loader";
import { formatByKey } from "@/lib/content/formats";
import { cleanBox, type Box } from "@/lib/visual/region";
import { ARTBOARDS, parseDesign, type ArtboardKind } from "@/lib/visual/design";
import { patchContent, rewritePartOf } from "./content";
import { saveDesign } from "./pipeline";
import { designOf, redrawArea } from "./pictures";
import type { ProjectScope } from "./projects";

export const COMMENT_TARGETS = ["picture", "headline", "body", "cta", "logo", "background"] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];
export const MAX_NOTE = 500;
/** Open and finished pins kept per visual; older ones are still in the table but not shown. */
export const MAX_PINS_SHOWN = 30;

export interface VisualComment {
  id: string;
  visualId: string;
  contentItemId: string;
  target: CommentTarget;
  box: Box;
  note: string;
  status: "open" | "working" | "applied" | "failed";
  result: string | null;
  jobId: string | null;
  createdAt: string;
}

export class CommentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentError";
  }
}

type Row = {
  id: string; visual_id: string; content_item_id: string; target: CommentTarget;
  box_x: number; box_y: number; box_w: number; box_h: number;
  note: string; status: VisualComment["status"]; result: string | null; job_id: string | null; created_at: Date;
};
const view = (r: Row): VisualComment => ({
  id: r.id, visualId: r.visual_id, contentItemId: r.content_item_id, target: r.target,
  box: { x: r.box_x, y: r.box_y, w: r.box_w, h: r.box_h }, note: r.note, status: r.status,
  result: r.result, jobId: r.job_id, createdAt: new Date(r.created_at).toISOString(),
});

/** The comments on a project's visuals, newest last. */
export async function listComments(scope: ProjectScope): Promise<VisualComment[]> {
  const rows = await withTenantSession(scope, async (c) =>
    (
      await c.query<Row>(
        `SELECT vc.* FROM visual_comments vc JOIN image_assets ia ON ia.id = vc.visual_id
          WHERE ia.project_id = $1 ORDER BY vc.created_at`,
        [scope.projectId],
      )
    ).rows,
  );
  return rows.map(view);
}

export async function getComment(scope: ProjectScope, id: string): Promise<VisualComment | null> {
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<Row>(
        `SELECT vc.* FROM visual_comments vc JOIN image_assets ia ON ia.id = vc.visual_id WHERE vc.id=$1 AND ia.project_id=$2`,
        [id, scope.projectId],
      ),
    )
  ).rows[0];
  return row ? view(row) : null;
}

export async function finishComment(scope: ProjectScope, id: string, outcome: { status: "applied" | "failed" | "working"; result?: string | null; pictureId?: string | null; jobId?: string | null }): Promise<void> {
  await withTenantSession(scope, (c) =>
    c.query(
      `UPDATE visual_comments SET status=$2, result=COALESCE($3, result), result_picture_id=COALESCE($4, result_picture_id), job_id=COALESCE($5, job_id) WHERE id=$1`,
      [id, outcome.status, outcome.result ?? null, outcome.pictureId ?? null, outcome.jobId ?? null],
    ),
  );
}

export async function dismissComment(scope: ProjectScope, id: string): Promise<boolean> {
  if (!(await getComment(scope, id))) return false;
  return withTenantSession(scope, async (c) => ((await c.query("DELETE FROM visual_comments WHERE id=$1 AND status <> 'working'", [id])).rowCount ?? 0) > 0);
}

/** The visual a comment is on, checked to be in this project. */
async function visualOf(scope: ProjectScope, visualId: string): Promise<{ id: string; contentItemId: string; artboard: ArtboardKind } | null> {
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string; content_item_id: string; kind: string }>(
        "SELECT id, content_item_id, kind FROM image_assets WHERE id=$1 AND project_id=$2 AND kind <> 'picture' AND content_item_id IS NOT NULL",
        [visualId, scope.projectId],
      ),
    )
  ).rows[0];
  if (!row) return null;
  const artboard: ArtboardKind = row.kind === "quote_card" ? "quote" : row.kind === "carousel_frame" ? "carousel" : "post";
  return { id: row.id, contentItemId: row.content_item_id, artboard };
}

/** Keep a new comment. Checks the box, the note and that the visual is this project's. */
export async function addComment(
  scope: ProjectScope,
  input: { visualId: string; target: string; box: Partial<Box>; note: string },
): Promise<VisualComment & { artboard: ArtboardKind }> {
  const v = await visualOf(scope, input.visualId);
  if (!v) throw new CommentError("That visual isn't in this project any more.");
  const target = (COMMENT_TARGETS as readonly string[]).includes(input.target) ? (input.target as CommentTarget) : null;
  if (!target) throw new CommentError("Pick a part of the visual to comment on.");
  const box = cleanBox(input.box);
  if (!box) throw new CommentError("Mark a bigger area to comment on.");
  const note = input.note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
  if (!note) throw new CommentError("Say what to change.");
  if (target === "picture" && !(await designOf(scope, v.contentItemId))?.pictures[v.artboard]) {
    throw new CommentError("That visual has no picture yet. Add one first, or comment on the text.");
  }
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<Row>(
        `INSERT INTO visual_comments (tenant_id, content_item_id, visual_id, target, box_x, box_y, box_w, box_h, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [scope.tenantId, v.contentItemId, v.id, target, box.x, box.y, box.w, box.h, note, scope.userId],
      ),
    )
  ).rows[0];
  return { ...view(row), artboard: v.artboard };
}

const PART_LABEL: Record<"headline" | "body" | "cta", string> = { headline: "Visual headline", body: "Body", cta: "Call to action" };

/**
 * Apply a comment on the visual's text or design, in the request (one Claude
 * call, a few seconds, like ask-for-a-change). Picture comments go to the
 * queue instead (applyPictureComment). Never throws: the outcome is on the comment.
 */
export async function applyTemplateComment(scope: ProjectScope, comment: VisualComment): Promise<VisualComment> {
  try {
    if (comment.target === "headline" || comment.target === "body" || comment.target === "cta") {
      const item = (
        await withTenantSession(scope, (c) =>
          c.query<{ hook: string; body: string; cta: string | null }>("SELECT hook, body, cta FROM content_items WHERE id=$1 AND project_id=$2", [comment.contentItemId, scope.projectId]),
        )
      ).rows[0];
      if (!item) throw new CommentError("That piece isn't in this project any more.");
      const field = comment.target === "headline" ? "hook" : comment.target;
      const before = (field === "hook" ? item.hook : field === "body" ? item.body : item.cta ?? "").trim();
      if (!before) throw new CommentError("There's no text there to change.");
      const next = await rewritePartOf(scope, comment.contentItemId, { part: PART_LABEL[comment.target], text: before, instruction: comment.note });
      if (!next || next.trim() === before) {
        await finishComment(scope, comment.id, { status: "failed", result: "That came back unchanged. Try saying it another way." });
      } else {
        await patchContent(scope, comment.contentItemId, { [field]: next.trim() });
        await finishComment(scope, comment.id, { status: "applied", result: `Changed to: ${next.trim().slice(0, 200)}` });
      }
    } else if (comment.target === "logo" || comment.target === "background") {
      const design = await designOf(scope, comment.contentItemId);
      if (!design) throw new CommentError("Make the visuals first.");
      const item = (await withTenantSession(scope, (c) => c.query<{ format: string }>("SELECT format FROM content_items WHERE id=$1", [comment.contentItemId]))).rows[0];
      const context = await loadBrandContext(scope, "en", formatByKey(item?.format ?? "linkedin_post").platform, "write");
      const t = design.tweaks;
      const patch = await runTask(scope, designChange, {
        context,
        contentItemId: comment.contentItemId,
        route: "cheap",
        taskInput: [
          `Part: ${comment.target}`,
          `Comment: ${comment.note}`,
          `Current: scale ${t.scale}, align ${t.align}, accent ${t.accent}, background ${t.background}, logo ${t.logo}, scrim ${t.scrim}`,
        ].join("\n"),
      });
      const tweaks = { ...t };
      if (patch.scale != null) tweaks.scale = patch.scale;
      if (patch.align) tweaks.align = patch.align;
      if (patch.accent) tweaks.accent = patch.accent;
      if (patch.background) tweaks.background = patch.background;
      if (patch.logo) tweaks.logo = patch.logo;
      if (patch.scrim) tweaks.scrim = patch.scrim;
      const next = parseDesign({ ...design, tweaks });
      const changed = JSON.stringify(next.tweaks) !== JSON.stringify(design.tweaks);
      if (changed) await saveDesign(scope, comment.contentItemId, next);
      await finishComment(scope, comment.id, { status: changed ? "applied" : "failed", result: patch.note.slice(0, 300) || (changed ? "Done." : "Nothing to change there.") });
    }
  } catch (e) {
    await finishComment(scope, comment.id, { status: "failed", result: e instanceof CommentError ? e.message : userMessage(e) }).catch(() => undefined);
  }
  return (await getComment(scope, comment.id)) ?? comment;
}

/** The queue's half of a picture comment: redraw the box, record the outcome. Throws so the queue can retry. */
export async function applyPictureComment(scope: ProjectScope, commentId: string): Promise<string> {
  const comment = await getComment(scope, commentId);
  if (!comment) throw new CommentError("That comment isn't there any more.");
  const v = await visualOf(scope, comment.visualId);
  if (!v) throw new CommentError("That visual isn't in this project any more.");
  const id = await redrawArea(scope, comment.contentItemId, v.artboard, comment.box, comment.note);
  await finishComment(scope, comment.id, { status: "applied", result: "Redrew the marked area.", pictureId: id });
  return id;
}

export { ARTBOARDS };
