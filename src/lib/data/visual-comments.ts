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
import { UnsupportedRewriteError } from "@/lib/voice/judge";
import { refusedClaimsNote } from "@/lib/visual/refusal";
import { loadBrandContext } from "@/lib/context/context-loader";
import { formatByKey } from "@/lib/content/formats";
import { cleanBox, cleanStrokes, strokesBox, type Box } from "@/lib/visual/region";
import { ERASE_NOTE, MAX_PINS_PER_SEND, PIN_KINDS, type PicturePin, type PinKind, type Stroke } from "@/lib/visual/picture-tools";
import { ARTBOARDS, parseDesign, type ArtboardKind } from "@/lib/visual/design";
import { patchContent, rewritePartOf } from "./content";
import { saveDesign } from "./pipeline";
import { CUTOUT_LOCKED, designOf, redrawArea } from "./pictures";
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
  /**
   * The picture version a picture comment made. The board compares it with
   * the picture in use: when that picture is no longer this version or one
   * made from it (an undo, an earlier version put back), the pin says so.
   */
  resultPictureId: string | null;
  createdAt: string;
  /** How a picture pin asks (lib/visual/picture-tools): a note on a box, drawn marks and a note, or a brushed area to erase. Always "comment" off the picture. */
  kind: PinKind;
  /**
   * The same place on the PICTURE itself (`box` is on the visual's frame, where
   * the pin shows; the picture is cropped to its slot, so they differ). Kept on
   * the row so Try again redraws the same area. Null when the board could not
   * work it out, and for text and design comments.
   */
  area: Box | null;
  /** Markup: the drawn marks. Erase: the brushed area. Fractions of the picture. Null for a plain comment. */
  strokes: Stroke[] | null;
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
  note: string; status: VisualComment["status"]; result: string | null; job_id: string | null; result_picture_id: string | null; created_at: Date;
  kind?: string | null; area?: unknown; strokes?: unknown;
};
const view = (r: Row): VisualComment => {
  // What was stored is read back through the same clean-up it was stored through, never trusted as is.
  const strokes = r.strokes == null ? [] : cleanStrokes(r.strokes);
  return {
    id: r.id, visualId: r.visual_id, contentItemId: r.content_item_id, target: r.target,
    box: { x: r.box_x, y: r.box_y, w: r.box_w, h: r.box_h }, note: r.note, status: r.status,
    result: r.result, jobId: r.job_id, resultPictureId: r.result_picture_id ?? null, createdAt: new Date(r.created_at).toISOString(),
    kind: (PIN_KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as PinKind) : "comment",
    area: cleanBox(r.area as Partial<Box> | null),
    strokes: strokes.length ? strokes : null,
  };
};

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

/** What a pin asks for, checked and capped, ready to store. */
interface CleanPin {
  kind: PinKind;
  box: Box;
  area: Box | null;
  strokes: Stroke[] | null;
  note: string;
}

/**
 * One pin as it may be kept. A comment needs a real box and a note; a markup
 * needs marks and a note; an erase needs a brushed area (its note is written
 * here). Strokes are capped and clamped (cleanStrokes); a markup's or an
 * erase's area is the box around its strokes when the board sent none.
 */
function cleanPin(input: { kind?: unknown; box?: Partial<Box> | null; area?: Partial<Box> | null; strokes?: unknown; note?: unknown }): CleanPin {
  const kind = (PIN_KINDS as readonly unknown[]).includes(input.kind) ? (input.kind as PinKind) : input.kind == null ? "comment" : null;
  if (!kind) throw new CommentError("That isn't a change a picture can take.");
  const strokes = kind === "comment" ? [] : cleanStrokes(input.strokes);
  if (kind === "markup" && strokes.length === 0) throw new CommentError("Draw on the picture to show what to change.");
  if (kind === "erase" && strokes.length === 0) throw new CommentError("Brush over what to erase first.");
  const typed = String(input.note ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
  const note = typed || (kind === "erase" ? ERASE_NOTE : "");
  if (!note) throw new CommentError("Say what to change.");
  const around = strokes.length ? strokesBox(strokes) : null;
  // The pin shows where the board says; a drawn pin with no usable box shows around its strokes.
  const box = cleanBox(input.box) ?? around;
  if (!box) throw new CommentError("Mark a bigger area to comment on.");
  return { kind, box, area: cleanBox(input.area) ?? around, strokes: strokes.length ? strokes : null, note };
}

const INSERT_COMMENT = `INSERT INTO visual_comments (tenant_id, content_item_id, visual_id, target, box_x, box_y, box_w, box_h, note, created_by, kind, area, strokes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`;

const insertArgs = (scope: ProjectScope, v: { id: string; contentItemId: string }, target: CommentTarget, pin: CleanPin, status: VisualComment["status"]) => [
  scope.tenantId, v.contentItemId, v.id, target, pin.box.x, pin.box.y, pin.box.w, pin.box.h, pin.note, scope.userId,
  pin.kind, pin.area ? JSON.stringify(pin.area) : null, pin.strokes ? JSON.stringify(pin.strokes) : null, status,
];

/**
 * Keep a new comment. Checks the box, the note and that the visual is this
 * project's. A picture comment may carry `area` (the box on the picture
 * itself), and a `kind` with `strokes` for a markup or an erase; all of it is
 * stored on the row, so the job and Try again read it from there.
 */
export async function addComment(
  scope: ProjectScope,
  input: { visualId: string; target: string; box: Partial<Box>; note: string; kind?: string; area?: Partial<Box> | null; strokes?: unknown },
): Promise<VisualComment & { artboard: ArtboardKind }> {
  const v = await visualOf(scope, input.visualId);
  if (!v) throw new CommentError("That visual isn't in this project any more.");
  const target = (COMMENT_TARGETS as readonly string[]).includes(input.target) ? (input.target as CommentTarget) : null;
  if (!target) throw new CommentError("Pick a part of the visual to comment on.");
  // Order kept from before the picture tools: a bad box is said before a missing note.
  if (!input.kind || input.kind === "comment") {
    if (!cleanBox(input.box)) throw new CommentError("Mark a bigger area to comment on.");
  } else if (target !== "picture") {
    throw new CommentError("Marks and erasing are for the picture. Comment on the text instead.");
  }
  const pin = cleanPin(input);
  if (target !== "picture") pin.area = null;
  if (target === "picture") {
    const picture = (await designOf(scope, v.contentItemId))?.pictures[v.artboard];
    if (!picture) throw new CommentError("That visual has no picture yet. Add one first, or comment on the text.");
    if (picture.cutout) throw new CommentError(CUTOUT_LOCKED);
  }
  const row = (await withTenantSession(scope, (c) => c.query<Row>(INSERT_COMMENT, insertArgs(scope, v, target, pin, "open")))).rows[0];
  return { ...view(row), artboard: v.artboard };
}

/**
 * Several pins on one visual's picture, kept together for one Send: every pin
 * is checked before any is stored, and they are stored in one transaction, so
 * a bad pin leaves nothing behind. They start 'working' (one job runs them, in
 * this order). Returns them in the order given.
 */
export async function addPictureComments(
  scope: ProjectScope,
  visualId: string,
  pins: unknown,
): Promise<{ comments: VisualComment[]; contentItemId: string; artboard: ArtboardKind }> {
  const v = await visualOf(scope, visualId);
  if (!v) throw new CommentError("That visual isn't in this project any more.");
  if (!Array.isArray(pins) || pins.length === 0) throw new CommentError("Pin at least one change on the picture.");
  if (pins.length > MAX_PINS_PER_SEND) throw new CommentError(`That's more than ${MAX_PINS_PER_SEND} changes in one go. Send some, then the rest.`);
  const clean = (pins as Partial<PicturePin>[]).map((p) => cleanPin(p ?? {}));
  const picture = (await designOf(scope, v.contentItemId))?.pictures[v.artboard];
  if (!picture) throw new CommentError("That visual has no picture yet. Add one first, or comment on the text.");
  if (picture.cutout) throw new CommentError(CUTOUT_LOCKED);
  const rows = await withTenantSession(scope, async (c) => {
    const out: Row[] = [];
    for (const pin of clean) out.push((await c.query<Row>(INSERT_COMMENT, insertArgs(scope, v, "picture", pin, "working"))).rows[0]);
    return out;
  });
  return { comments: rows.map(view), contentItemId: v.contentItemId, artboard: v.artboard };
}

/** Point several comments at the job that runs them. */
export async function setCommentsJob(scope: ProjectScope, ids: string[], jobId: string): Promise<void> {
  if (!ids.length) return;
  await withTenantSession(scope, (c) => c.query("UPDATE visual_comments SET job_id=$2 WHERE id = ANY($1::uuid[])", [ids, jobId]));
}

/**
 * A picture job stopped for good: every one of its pins that is still waiting
 * says why. Pins already applied, or already failed for their own reason,
 * keep what they say.
 */
export async function failWaitingComments(scope: ProjectScope, ids: string[], message: string): Promise<void> {
  const clean = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
  if (!clean.length) return;
  await withTenantSession(scope, (c) =>
    c.query(
      `UPDATE visual_comments vc SET status='failed', result=$2
         FROM image_assets ia
        WHERE vc.id = ANY($1::uuid[]) AND vc.status IN ('open', 'working') AND ia.id = vc.visual_id AND ia.project_id = $3`,
      [clean, message, scope.projectId],
    ),
  );
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
    // A rewrite refused for adding claims says which claims (lib/visual/refusal).
    const result = e instanceof CommentError ? e.message : e instanceof UnsupportedRewriteError ? refusedClaimsNote(e.claims) : userMessage(e);
    await finishComment(scope, comment.id, { status: "failed", result }).catch(() => undefined);
  }
  return (await getComment(scope, comment.id)) ?? comment;
}

/** The queue's half of a picture comment: redraw the box, record the outcome. Throws so the queue can retry. */
/**
 * `area` is the box in the PICTURE's own coordinates, measured by the board
 * through the visual's layout and the picture's object-cover crop. The stored
 * box is in the visual frame's coordinates (it places the pin), and the two
 * differ whenever the picture is cropped or fills only part of the frame
 * (2026-11-17 test: redraws landed about 8% too high on a 4:5 post).
 */
/**
 * Since the picture tools (2026-11-18) the area is kept on the comment's own
 * row, with its kind and its strokes, and read from there: a retry or Try
 * again then works on the same area. `area` (the job payload of a comment
 * queued before that) is still honoured when the row has none.
 */
export async function applyPictureComment(scope: ProjectScope, commentId: string, area?: Partial<Box> | null): Promise<string> {
  const comment = await getComment(scope, commentId);
  if (!comment) throw new CommentError("That comment isn't there any more.");
  if (comment.target !== "picture") throw new CommentError("That comment isn't on the picture.");
  const v = await visualOf(scope, comment.visualId);
  if (!v) throw new CommentError("That visual isn't in this project any more.");
  const id = await redrawArea(scope, comment.contentItemId, v.artboard, {
    box: comment.area ?? cleanBox(area) ?? comment.box,
    note: comment.note,
    kind: comment.kind,
    strokes: comment.strokes ?? undefined,
  });
  await finishComment(scope, comment.id, { status: "applied", result: APPLIED[comment.kind], pictureId: id });
  return id;
}

const APPLIED: Record<PinKind, string> = {
  comment: "Redrew the marked area.",
  markup: "Changed it as marked.",
  erase: "Erased what was brushed over.",
};

/**
 * The comment behind "Try again": it must be this project's and must have
 * failed. A comment that went through is never run twice (a text comment
 * would rewrite the rewrite), and one still working is left to finish.
 */
export async function failedComment(scope: ProjectScope, id: string): Promise<VisualComment & { artboard: ArtboardKind }> {
  const comment = await getComment(scope, id);
  if (!comment) throw new CommentError("That comment isn't there any more.");
  if (comment.status !== "failed") throw new CommentError(comment.status === "working" ? "That comment is still being worked on." : "That comment already went through.");
  const v = await visualOf(scope, comment.visualId);
  if (!v) throw new CommentError("That visual isn't in this project any more.");
  return { ...comment, artboard: v.artboard };
}

export { ARTBOARDS };
