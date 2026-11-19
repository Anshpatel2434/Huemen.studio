/**
 * Pictures on visuals: drawn by the image model (ChatGPT Image through
 * lib/ai, or the stand-in), stored in the workspace's own storage, attached to
 * one visual of a piece (post image, quote card or carousel cover).
 *
 *   drawPicture    Claude writes the brief from the brand context (INV-2,
 *                  task image_brief); the image model draws it; the picture is
 *                  stored and becomes the visual's current picture.
 *   redrawArea     one marked box of the current picture is redrawn as asked;
 *                  everything outside the box is the original, pixel for pixel
 *                  (lib/visual/region). The result is a new version.
 *                  The picture tools (2026-11-18) use the same call for a
 *                  Markup change (marks drawn on the picture, a note) and an
 *                  Erase (a brushed area), each with its own guarantee.
 *   resizePicture  a new shape: a crop where the picture covers the new
 *                  frame (sharp, no model call), otherwise the image model
 *                  draws the extra area and the original is pasted back over
 *                  its place.
 *   cutOutPicture  the background removed (lib/ai cutoutImage): a PNG with
 *                  alpha, as a new version.
 *   previousPicture / removePicture / pictureLinks / pictureVersions
 *
 * Slow calls run in the job queue (lib/jobs kinds picture_generate,
 * picture_edit, picture_resize and picture_cutout); these functions are what
 * the jobs call.
 *
 * Server-only.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { PoolClient } from "pg";
import { withTenantSession } from "@/db/session";
import { cutoutImage, editImage, generateImage, PictureSpend, runTask, withPictureBudget } from "@/lib/ai";
import { cutoutStatus } from "@/lib/ai/cutout";
import { imageBrief } from "@/lib/ai/tasks";
import type { ImageShape } from "@/lib/ai/types";
import { loadBrandContext } from "@/lib/context/context-loader";
import { cutAtSentence } from "@/lib/context/cut";
import { formatByKey } from "@/lib/content/formats";
import { appSignedUrl, storage, tenantKey } from "@/lib/storage";
import {
  boxesMask, changeInside, cleanBox, cleanStrokes, cutAtEdge, driftOf, EDGE_CUT_LIMIT, brushedSpan, fillThin, growBox, keptInside, objectBoxAt, shadowGrownMask, unionBox, keepInsideMask, marksLeft, maskHasArea, keepOriginal, keepOutside, placeOnCanvas, regionMask, seamOf, strokeMask, strokesBox, strokesOverlay,
  visiblePart, type Box, type PixelRect,
} from "@/lib/visual/region";
import { boxesWithin, wordGroups } from "@/lib/visual/picture-words";
import type { BrandContext } from "@/lib/context/context-builder";
import { lookForWords } from "./picture-words";
import {
  clearSubject, coversFrame, MIN_EXTEND_COVER, PICTURE_BUDGET, RESIZE_RATIO, type PictureOp, type PinKind, type ResizeInput, type Stroke,
} from "@/lib/visual/picture-tools";
import { parseDesign, type ArtboardKind, type Design, type PictureMode } from "@/lib/visual/design";
import { schemeIndex, schemesFrom, type Scheme } from "@/lib/visual/schemes";
import { stripMarkers } from "@/lib/visual/markers";
import { loadFoundation } from "@/lib/data/foundation";
import { logger } from "@/lib/observability/log";
import type { ProjectScope } from "./projects";

export class PictureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PictureError";
  }
}

/** The shape asked of the model for each visual; the template crops to its exact frame. */
export function shapeFor(artboard: ArtboardKind, format: string): ImageShape {
  if (artboard === "quote") return "square";
  if (artboard === "carousel") return "portrait";
  const { w, h } = formatByKey(format).frame;
  return w > h * 1.15 ? "landscape" : h > w * 1.15 ? "portrait" : "square";
}

interface Piece {
  id: string;
  format: string;
  hook: string;
  body: string;
  cta: string | null;
  /** What was decided at Ideate: what the piece is about, the pillar it sits under and the angle it takes. */
  topic: string | null;
  angle: string | null;
  pillar: string | null;
  pillar_note: string | null;
}

async function pieceOf(scope: ProjectScope, contentItemId: string): Promise<Piece> {
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<Piece>(
        `SELECT ci.id, ci.format, ci.hook, ci.body, ci.cta,
                coalesce(nullif(ci.topic, ''), p.name) AS topic, p.angle,
                pl.name AS pillar, pl.description AS pillar_note
           FROM content_items ci
           JOIN projects p ON p.id = ci.project_id
           LEFT JOIN pillars pl ON pl.id = coalesce(ci.pillar_id, p.pillar_id)
          WHERE ci.id = $1 AND ci.project_id = $2`,
        [contentItemId, scope.projectId],
      ),
    )
  ).rows[0];
  if (!row) throw new PictureError("That piece isn't in this project any more.");
  // The words a picture carries are visual text: no markdown emphasis in them (lib/visual/markers).
  return { ...row, hook: stripMarkers(row.hook), body: stripMarkers(row.body), cta: row.cta === null ? null : stripMarkers(row.cta) };
}

/** The piece's design, read from its visual rows (they all carry the same one). */
export async function designOf(scope: ProjectScope, contentItemId: string): Promise<Design | null> {
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<{ params: unknown }>(
        "SELECT params FROM image_assets WHERE content_item_id=$1 AND project_id=$2 AND kind <> 'picture' ORDER BY created_at LIMIT 1",
        [contentItemId, scope.projectId],
      ),
    )
  ).rows[0];
  return row ? parseDesign(row.params) : null;
}

/**
 * What a picture change came to, for the job that ran it (lib/jobs):
 *   attached  false when the visual was pointed at another picture while the
 *             change was being made (a version chosen, Back, Take off, undo):
 *             the result is kept as a version and the person's choice stays
 *             on the visual (PI-26).
 *   spend     the paid pictures it used, its retries included (PI-30).
 */
export interface PictureRun {
  attached?: boolean;
  spend?: PictureSpend;
}

/** Point one visual at a picture (or at none). The rest of the design is untouched. */
async function attach(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, ref: { id: string; mode: PictureMode; cutout?: boolean } | null): Promise<void> {
  const design = await designOf(scope, contentItemId);
  if (!design) throw new PictureError("Make the visuals first; a picture goes on one of them.");
  const pictures = { ...design.pictures };
  // `cutout` is only ever stored as true (lib/visual/design PictureRef).
  if (ref) pictures[artboard] = { id: ref.id, mode: ref.mode, ...(ref.cutout ? { cutout: true } : {}) };
  else delete pictures[artboard];
  await withTenantSession(scope, (c) =>
    c.query(
      "UPDATE image_assets SET params = params || $1::jsonb WHERE content_item_id=$2 AND project_id=$3 AND kind <> 'picture'",
      [JSON.stringify({ pictures }), contentItemId, scope.projectId],
    ),
  );
}

interface PictureRow {
  id: string;
  storage_key: string;
  prompt: string | null;
  params: { artboard?: ArtboardKind; mode?: PictureMode; shape?: ImageShape; heading?: string | null; avoid?: string; op?: PictureOp; cutout?: boolean; textLeft?: boolean; wordsUnchecked?: boolean } | null;
  parent_id: string | null;
  width: number | null;
  height: number | null;
  created_at: Date;
}

async function pictureRow(scope: ProjectScope, id: string): Promise<PictureRow | null> {
  return (
    await withTenantSession(scope, (c) =>
      c.query<PictureRow>(
        "SELECT id, storage_key, prompt, params, parent_id, width, height, created_at FROM image_assets WHERE id=$1 AND project_id=$2 AND kind='picture'",
        [id, scope.projectId],
      ),
    )
  ).rows[0] ?? null;
}

/** What a new picture version records about itself. */
interface PictureMeta {
  artboard: ArtboardKind; mode: PictureMode; shape: ImageShape; prompt: string; model: string; avoid?: string; heading: string | null; parentId: string | null;
  /** How this version came to be (lib/visual/picture-tools PictureOp), for the versions strip. */
  op: PictureOp;
  /** The background has been removed: the file is a PNG with alpha. */
  cutout?: boolean;
  /** A picture that must have no words may still show some (keepWordsOut): the board says so. */
  textLeft?: boolean;
  /** The words check could not run (not set up, busy, out of allowance): the board says "Words not checked" (PI-20). */
  wordsUnchecked?: boolean;
}

/**
 * Point the visual at `ref` inside an open transaction, but only while it
 * still shows `expect` (the picture the change started from; null for none):
 * the visual rows are locked first, so a version chosen at the same moment
 * either lands before (and this does not attach) or after. Returns whether it
 * attached. One current picture per visual: when it attaches, every other
 * version of this visual stops being current.
 */
async function pointAt(
  c: PoolClient, scope: ProjectScope, contentItemId: string, artboard: ArtboardKind,
  ref: { id: string; mode: PictureMode; cutout?: boolean }, expect: string | null,
): Promise<boolean> {
  const rows = (
    await c.query<{ params: unknown }>(
      "SELECT params FROM image_assets WHERE content_item_id=$1 AND project_id=$2 AND kind <> 'picture' ORDER BY created_at FOR UPDATE",
      [contentItemId, scope.projectId],
    )
  ).rows;
  if (!rows.length) throw new PictureError("Make the visuals first; a picture goes on one of them.");
  const design = parseDesign(rows[0].params);
  if ((design.pictures[artboard]?.id ?? null) !== expect) return false;
  await c.query(
    "UPDATE image_assets SET is_current = (id = $4) WHERE content_item_id=$1 AND project_id=$2 AND kind='picture' AND params->>'artboard'=$3 AND (is_current OR id = $4)",
    [contentItemId, scope.projectId, artboard, ref.id],
  );
  const pictures = { ...design.pictures, [artboard]: { id: ref.id, mode: ref.mode, ...(ref.cutout ? { cutout: true } : {}) } };
  await c.query(
    "UPDATE image_assets SET params = params || $1::jsonb WHERE content_item_id=$2 AND project_id=$3 AND kind <> 'picture'",
    [JSON.stringify({ pictures }), contentItemId, scope.projectId],
  );
  return true;
}

/**
 * Store picture bytes, record the row, and make it the visual's picture, in
 * one transaction, if the visual still shows `expect` (compare-and-set,
 * PI-26). Otherwise the new version is kept (not current) and the visual
 * stays on what the person chose meanwhile. Model output is kept as drawn
 * (its provenance data included).
 */
async function commitPicture(
  scope: ProjectScope, piece: Piece, bytes: Uint8Array, meta: PictureMeta, expect: string | null,
): Promise<{ id: string; attached: boolean }> {
  const info = await sharp(Buffer.from(bytes)).metadata().catch(() => null);
  if (!info?.width || !info.height || info.format !== "png") throw new PictureError("The picture came back unreadable. Try again.");
  const key = tenantKey(scope.tenantId!, "pictures", `${randomUUID()}.png`);
  await storage().put(key, bytes, "image/png");
  return withTenantSession(scope, async (c) => {
    const id = (
      await c.query<{ id: string }>(
        `INSERT INTO image_assets (tenant_id, project_id, content_item_id, kind, prompt, model, params, aspect_ratio, storage_key, width, height, status, created_by, parent_id, is_current)
         VALUES ($1,$2,$3,'picture',$4,$5,$6,$7,$8,$9,$10,'ready',$11,$12,false) RETURNING id`,
        [
          scope.tenantId, scope.projectId, piece.id, meta.prompt, meta.model,
          JSON.stringify({
            artboard: meta.artboard, mode: meta.mode, shape: meta.shape, heading: meta.heading, avoid: meta.avoid ?? "",
            op: meta.op, ...(meta.cutout ? { cutout: true } : {}), ...(meta.textLeft ? { textLeft: true } : {}), ...(meta.wordsUnchecked ? { wordsUnchecked: true } : {}),
          }),
          `${info.width}:${info.height}`, key, info.width, info.height, scope.userId, meta.parentId,
        ],
      )
    ).rows[0].id;
    const attached = await pointAt(c, scope, piece.id, meta.artboard, { id, mode: meta.mode, cutout: meta.cutout }, expect);
    if (!attached) logger.info("picture_kept_as_version", { tenantId: scope.tenantId, contentItemId: piece.id, artboard: meta.artboard, id, op: meta.op });
    return { id, attached };
  });
}

/**
 * What every picture is told to stay away from, whatever the brief said. The
 * first real picture (2026-11-17) was an invented man in a suit by a skyline
 * for a post about writing: well drawn, and exactly what every generic post
 * uses. An invented person is also a face nobody agreed to.
 */
const ALWAYS_AVOID = "people, faces, portraits, hands, business suits, office skyline, skyscrapers, handshakes, stock photo, corporate stock imagery, clip art, glossy 3D render, watermark, text, letters, logos, hex codes, colour codes, app screens, UI mock-ups, dashboards, chat windows, device screens showing writing, brand logos";

/** The code-owned lines about words, codes, screens and people in the picture. */
export function pictureInstructions(mode: PictureMode, heading: string): string {
  const noPeople = "No people, faces or hands.";
  const noCodes = "No hex codes, colour codes, UI, app or chat screens, and no logos.";
  return mode === "with_text"
    ? [`Text: "${heading.replace(/"/g, "'")}"`, `Show this text exactly once, spelled exactly as given, large and legible, in a clean sans-serif. No other words, letters, numbers or codes. ${noCodes} ${noPeople}`].join("\n")
    : `No words, letters, numbers, hex codes or logos anywhere in the picture. ${noCodes} No screens or devices showing writing. ${noPeople} Leave calm, uncluttered space where a headline will sit on top.`;
}

/**
 * The colour lines of a picture's brief: the brand palette as hex, and the
 * colours of the visual's own scheme (ground, ink, accent). The brief turns
 * them into colour words for the picture; the picture never prints a code.
 */
export function colourLines(palette: string[], scheme: Scheme | null): string[] {
  const own = palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toUpperCase());
  return [
    own.length ? `Brand palette (hex): ${own.join(", ")}` : "Brand palette: none set, so the house colours stand in.",
    scheme ? `This visual's colours (hex): ground ${scheme.bg.toUpperCase()}, ink ${scheme.fg.toUpperCase()}, accent ${scheme.accent.toUpperCase()}.` : "",
  ].filter(Boolean);
}

/** A picture lock runs out this long after its last renewal: a crashed worker's lock frees itself. */
const LOCK_TTL_S = 120;
/** The worker renews its lock this often while it works. */
const LOCK_RENEW_MS = 30_000;
/** A change waits at most this long for the one before it on the same visual (a job's lease is 330 s). */
const LOCK_WAIT_MS = 360_000;
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * One picture change per visual at a time. A draw or an area redraw reads the
 * visual's CURRENT picture, works on it for as long as the image model takes,
 * and then makes its result the current one. Two of them side by side (two
 * comments sent quickly, two workers) would both start from the same version
 * and the second to finish would drop the first one's change. So each holds a
 * lock named for the piece and the visual while it works: the second waits,
 * then starts from the first one's result.
 *
 * The lock is a row in picture_locks (RLS, its own workspace) with a holder
 * and an expiry renewed every LOCK_RENEW_MS, never an open transaction: an
 * advisory lock held across a 30 to 300 s model call kept a pooled
 * connection idle in a transaction for all of it (PI-38). Let go in finally;
 * a worker that dies loses it after LOCK_TTL_S.
 */
async function oneAtATime<T>(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, work: () => Promise<T>): Promise<T> {
  if (!isId(contentItemId)) throw new PictureError("That piece isn't in this project any more.");
  const holder = randomUUID();
  const started = Date.now();
  for (;;) {
    let got = false;
    try {
      got = await withTenantSession(scope, async (c) =>
        ((
          await c.query(
            `INSERT INTO picture_locks (tenant_id, content_item_id, artboard, holder, locked_until)
             VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
             ON CONFLICT (content_item_id, artboard) DO UPDATE SET holder = EXCLUDED.holder, locked_until = EXCLUDED.locked_until, created_at = now()
               WHERE picture_locks.locked_until < now()
             RETURNING holder`,
            [scope.tenantId, contentItemId, artboard, holder, LOCK_TTL_S],
          )
        ).rowCount ?? 0) > 0,
      );
    } catch (e) {
      // The piece is not this workspace's (the lock's link to it is checked, 0022).
      if ((e as { code?: string }).code === "23503") throw new PictureError("That piece isn't in this project any more.");
      throw e;
    }
    if (got) break;
    if (Date.now() - started > LOCK_WAIT_MS) throw new PictureError("This picture is still being changed. Try again in a moment.");
    await new Promise((r) => setTimeout(r, 1000));
  }
  const renew = setInterval(() => {
    void withTenantSession(scope, (c) =>
      c.query("UPDATE picture_locks SET locked_until = now() + make_interval(secs => $4) WHERE content_item_id=$1 AND artboard=$2 AND holder=$3", [contentItemId, artboard, holder, LOCK_TTL_S]),
    ).catch(() => undefined);
  }, LOCK_RENEW_MS);
  renew.unref?.();
  try {
    return await work();
  } finally {
    clearInterval(renew);
    await withTenantSession(scope, (c) => c.query("DELETE FROM picture_locks WHERE content_item_id=$1 AND artboard=$2 AND holder=$3", [contentItemId, artboard, holder])).catch(() => undefined);
  }
}

/** A picture action under its budget of paid pictures (PI-30), reporting what it used and whether it attached. */
async function budgeted(max: number, run: PictureRun | undefined, work: () => Promise<{ id: string; attached: boolean }>): Promise<string> {
  const spend = run?.spend ?? new PictureSpend(max);
  if (run) run.spend = spend;
  const out = await withPictureBudget(max, work, spend);
  if (run) run.attached = out.attached;
  return out.id;
}

/** Draw a new picture for one visual and make it that visual's picture. Returns its id. */
export async function drawPicture(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, mode: PictureMode, run?: PictureRun): Promise<string> {
  return oneAtATime(scope, contentItemId, artboard, () => budgeted(PICTURE_BUDGET.draw, run, () => drawPictureNow(scope, contentItemId, artboard, mode)));
}

/** One line of at most `max` characters, for a line of the picture brief. */
const one = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The picture brief carries the whole piece (M3): the body is given in full unless
 * it is past this many characters, and then it is cut at a sentence, never
 * mid-sentence. The drawn heading is never cut (it is the stored heading).
 */
const PICTURE_BODY_MAX = 2000;
const PICTURE_CTA_MAX = 400;

/** The colours of the piece's visual scheme, read the way the board reads them (lib/visual/schemes). */
async function schemeOfPiece(scope: ProjectScope, contentItemId: string, palette: string[]): Promise<Scheme | null> {
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<{ params: { scheme?: number; schemeOrder?: number } | null }>(
        "SELECT params FROM image_assets WHERE content_item_id=$1 AND project_id=$2 AND kind <> 'picture' ORDER BY created_at LIMIT 1",
        [contentItemId, scope.projectId],
      ),
    )
  ).rows[0];
  if (!row) return null;
  const at = schemeIndex(palette, Number(row.params?.scheme ?? 0), Number(row.params?.schemeOrder ?? 1));
  return schemesFrom(palette)[at] ?? null;
}

async function drawPictureNow(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, mode: PictureMode): Promise<{ id: string; attached: boolean }> {
  const piece = await pieceOf(scope, contentItemId);
  const design = await designOf(scope, contentItemId);
  if (!design) throw new PictureError("Make the visuals first; a picture goes on one of them.");
  // What the visual shows as this starts: the new picture goes on only if that is still so (PI-26).
  const from = design.pictures[artboard]?.id ?? null;
  const fmt = formatByKey(piece.format);
  const shape = shapeFor(artboard, piece.format);
  const context = await loadBrandContext(scope, "en", fmt.platform, "write");
  // The brand's palette and this visual's own colours, as hex: the picture is drawn in them (F7).
  const palette = (await loadFoundation(scope)).palette.split(",").map((s) => s.trim()).filter((s) => /^#[0-9a-f]{3,8}$/i.test(s));
  const scheme = await schemeOfPiece(scope, contentItemId, palette);
  const brief = await runTask(scope, imageBrief, {
    context,
    contentItemId,
    // The art direction decides whether the picture is this piece's or anyone's:
    // it gets the stronger model, and the whole piece, not only its first line.
    route: "strong",
    taskInput: [
      `Format: ${fmt.label}`,
      `Visual: ${artboard === "post" ? "post image" : artboard === "quote" ? "quote card" : "carousel cover"}`,
      `Shape: ${shape}`,
      ...colourLines(palette, scheme),
      // What Ideate decided, then what Content wrote: the picture answers both.
      piece.topic ? `What the piece is about (chosen at Ideate): ${one(piece.topic, 300)}` : "",
      piece.pillar ? `Pillar: ${one(piece.pillar, 80)}${piece.pillar_note ? ` (${one(piece.pillar_note, 160)})` : ""}` : "",
      piece.angle ? `Angle: ${one(piece.angle, 200)}` : "",
      `Piece: ${piece.hook.replace(/\s+/g, " ").trim()}`,
      `What it says: ${cutAtSentence(piece.body.replace(/\s+/g, " "), PICTURE_BODY_MAX).text}`,
      piece.cta ? `It ends by asking: ${cutAtSentence(piece.cta.replace(/\s+/g, " "), PICTURE_CTA_MAX).text}` : "",
      mode === "with_text" ? `Text to show: ${piece.hook.replace(/\s+/g, " ").trim()}` : "Leave space: lower third",
    ].filter(Boolean).join("\n"),
  });
  const prompt = `${brief.scene.trim()}\n\n${pictureInstructions(mode, piece.hook)}`;
  // With the heading drawn in, text is wanted: only stray words are ruled out, by the instructions above.
  const avoid = [brief.avoid.trim(), mode === "with_text" ? ALWAYS_AVOID.replace(", text, letters", "") : ALWAYS_AVOID].filter(Boolean).join(", ");
  const draw = () => generateImage(scope, { context, prompt, negativePrompt: avoid, shape, contentItemId });
  let out: { bytes: Uint8Array; model: string; textLeft?: boolean; unchecked?: boolean } = await draw();
  // Under live text the picture must have no words of its own: looked for, erased, or drawn again once.
  if (mode === "live_text") out = await keepWordsOut(scope, { context, bytes: out.bytes, model: out.model, shape, contentItemId, why: "a new picture", redraw: draw });
  return commitPicture(scope, piece, out.bytes, {
    artboard, mode, shape, prompt, model: out.model, avoid: brief.avoid, heading: mode === "with_text" ? piece.hook : null, parentId: null, op: "draw",
    textLeft: out.textLeft, wordsUnchecked: out.unchecked,
  }, from);
}

/**
 * Redraw one marked area of a visual's current picture, as asked. The model
 * gets the picture, a mask of the area and the note; the result is used only
 * inside the area, so nothing else in the picture can change. Returns the new
 * version's id.
 */
export async function redrawArea(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, edit: AreaEdit, run?: PictureRun): Promise<string>;
export async function redrawArea(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, box: Box, note: string): Promise<string>;
export async function redrawArea(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, boxOrEdit: Box | AreaEdit, noteOrRun?: string | PictureRun): Promise<string> {
  // The first form is the one that grew (a kind, strokes); the second is how a plain comment has always been sent.
  const edit: AreaEdit = "box" in boxOrEdit ? boxOrEdit : { box: boxOrEdit, note: typeof noteOrRun === "string" ? noteOrRun : "", kind: "comment" };
  const run = typeof noteOrRun === "object" ? noteOrRun : undefined;
  const kind: PinKind = edit.kind === "markup" || edit.kind === "erase" ? edit.kind : "comment";
  return oneAtATime(scope, contentItemId, artboard, () => budgeted(PICTURE_BUDGET[kind], run, () => redrawAreaNow(scope, contentItemId, artboard, edit)));
}

/**
 * One change to an area of a picture.
 *
 *   comment  `box` is the area and `note` what to put there (as before).
 *   markup   `strokes` are marks drawn on the picture (a circle, an arrow) and
 *            `note` says what to do. The area that may change is the box
 *            around the marks, padded (a drawn circle is a ring, so the marks
 *            themselves are not the area); the model is shown the marks and
 *            told to follow them, then remove them. `box` is used when there
 *            are no strokes.
 *   erase    `strokes` are the brushed area: what is under it is removed and
 *            filled from around it. Only brushed pixels can change.
 */
export interface AreaEdit {
  box: Box;
  note: string;
  kind?: PinKind;
  strokes?: Stroke[];
  /** The box came from one click, not a drag: it may be widened once when the change does not fit inside it. */
  auto?: boolean;
}

/** How much wider and taller a one-click area gets for its second try. */
export const AUTO_AREA_GROW = 1.7;

/** The padding around drawn marks (a share of the picture's shorter side): what the marks point at may reach past them. */
export const MARKUP_PAD = 0.08;
/** The colour the model is shown the marks in: one a picture is unlikely to have. */
export const MARKS_COLOUR = "#ff00ff";
/** More than this share of the marked area still in the marks colour after an edit, and it is not kept. */
const MARKS_LEFT_MAX = 0.004;
/** The widest soft edge inside a brushed area, in pixels; a thin brush gets a thinner one so its middle is fully erased. */
const ERASE_FEATHER = 12;
/**
 * Less change than this inside the brushed area (mean colour difference, 0-1)
 * and an erase removed nothing. Live: a kept rod measured 0.019, a real
 * change 0.13.
 */
export const ERASE_MIN_CHANGE = 0.03;
/**
 * More of what was brushed still there than this (lib/visual/region keptInside,
 * 0-1) and the model kept it. Measured 2026-11-19 with the app's brush (0.06): a
 * skirting line the model kept, 0.843 on the live site (0.977 with a thinner brush);
 * the same line removed, 0.529 (the wall and floor still meet across the brush);
 * an erased block, 0.000.
 */
export const ERASE_KEPT_MAX = 0.7;
/**
 * A brushed area this narrow across (lib/visual/region brushedSpan, a share of the
 * picture's shorter side) or narrower is a line: when the model keeps it, it is filled
 * from its two sides instead. One pass of the app's brush (BRUSH_WIDTH 0.06) measures
 * about 0.06 to 0.08; a scribble over an object, several times that.
 */
export const ERASE_THIN_SPAN = 0.1;

export const CUTOUT_LOCKED = "This picture has its background removed. Go back to the version before to change it.";

interface CurrentPicture {
  piece: Piece;
  ref: { id: string; mode: PictureMode; cutout?: boolean };
  row: PictureRow;
  bytes: Uint8Array;
  width: number;
  height: number;
  cutout: boolean;
}

/** The picture a visual shows now: its row, its file and its size. Refuses plainly when any of it is gone. */
async function currentPicture(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind): Promise<CurrentPicture> {
  const piece = await pieceOf(scope, contentItemId);
  const ref = (await designOf(scope, contentItemId))?.pictures[artboard];
  if (!ref) throw new PictureError("That visual has no picture to change.");
  const row = await pictureRow(scope, ref.id);
  if (!row) throw new PictureError("That picture isn't there any more. Draw a new one.");
  const obj = await storage().get(row.storage_key);
  if (!obj) throw new PictureError("That picture's file is missing. Draw a new one.");
  const meta = await sharp(Buffer.from(obj.data)).metadata();
  if (!meta.width || !meta.height) throw new PictureError("That picture couldn't be read.");
  return { piece, ref, row, bytes: obj.data, width: meta.width, height: meta.height, cutout: ref.cutout === true || row.params?.cutout === true };
}

/** What an erase asks of the model (a brushed area, or the words found in a picture). */
const ERASE_PROMPT = [
  "Change only the marked area: remove what is there and fill it with the surrounding background or surface, continuing its texture, light and colours. Add nothing new.",
  "Keep everything else exactly as it is: the same subject, style, light and colours.",
  "No words, letters or logos.",
].join("\n");

/**
 * Erase the masked part of a picture (the erase endpoint, AI_IMAGE_ERASE_MODEL)
 * and keep the result only inside the mask: every other pixel is the
 * original's (keepInsideMask). An answer with nothing removed is tried once
 * more and then refused (`minChange`; 0 skips that, when something else
 * judges the result); one with the brush paint left in `area` is refused.
 */
async function eraseArea(
  scope: ProjectScope,
  a: {
    context: BrandContext; bytes: Uint8Array; mask: Uint8Array; shape: ImageShape; contentItemId: string; feather: number; area: Box | null; minChange?: number;
    /** Only the words in the mask go (ImageEditRequest `erase`), not everything there. */
    words?: boolean;
    /** The brush is a thin line (ERASE_THIN_STROKE): kept by the model, it is filled from its sides (lib/visual/region fillThin). */
    thin?: boolean;
  },
): Promise<{ bytes: Uint8Array; model: string }> {
  const minChange = a.minChange ?? ERASE_MIN_CHANGE;
  const call = () => editImage(scope, {
    context: a.context, prompt: ERASE_PROMPT, source: a.bytes, mask: a.mask, shape: a.shape, contentItemId: a.contentItemId, intent: "erase",
    ...(a.words ? { erase: "words" as const } : {}),
  });
  // The model's answer, kept inside the brush and, for a plain erase, in the shadow
  // it lifted along with what was erased (lib/visual/region shadowGrownMask): only
  // the brush was kept before, so a shadow past it stayed, cut off in a hard line.
  const keep = async (answer: Uint8Array) => {
    const grown = a.words ? null : await shadowGrownMask(a.bytes, answer, a.mask).catch(() => null);
    return keepInsideMask(a.bytes, answer, grown ?? a.mask, a.feather);
  };
  // What the model handed back unchanged: little change, or the brushed part still there.
  const keptBack = async (merged: Uint8Array) =>
    minChange > 0 && ((await changeInside(a.bytes, merged, a.mask)) < minChange || (await keptInside(a.bytes, merged, a.mask)) > ERASE_KEPT_MAX);
  let out = await call();
  let merged = await keep(out.bytes);
  // A thin line the model kept (a skirting it took for part of the room, 2026-11-19):
  // filled from its two sides, no second paid try that would keep it again.
  if (a.thin && (await keptBack(merged))) {
    return { bytes: await keepInsideMask(a.bytes, await fillThin(a.bytes, a.mask), a.mask, Math.min(a.feather, 2)), model: "fill" };
  }
  // A model that hands the brushed part back as it was removed nothing (live,
  // a rod on a pan, 2026-11-18): one more go, then a plain refusal, never a
  // new version that looks like the old one.
  if (await keptBack(merged)) {
    out = await call();
    merged = await keep(out.bytes);
    if (await keptBack(merged)) {
      throw new PictureError("The erase came back with nothing removed, so it wasn't kept. Try brushing a little wider.");
    }
  }
  // Never save a result with the brush paint still in it.
  if (a.area && (await marksLeft(a.bytes, merged, a.area)) > MARKS_LEFT_MAX) {
    throw new PictureError("The erase came back with the brush marks still in it, so it wasn't kept. Try again, or brush a little wider.");
  }
  return { bytes: merged, model: out.model };
}

/**
 * How long the word check may keep starting new work (an erase, a redraw).
 * Live 2026-11-19: a look takes 1-15 s on Groq (more when it waits out a
 * per-minute limit), an erase 25-45 s, three erases and two looks 140 s. A
 * new picture's job (330 s lease) has spent about 50 s on the brief and the
 * draw before this starts.
 */
const WORDS_TRY_BUDGET_MS = 120_000;

/**
 * Words in a picture that must have none (lib/visual/picture-words). The
 * vision model looks (lib/data/picture-words lookForWords); words it finds
 * are erased through eraseArea, so outside the words' boxes every pixel is
 * the picture's own, and it looks once more. Still there: a fresh draw gets
 * one redraw from scratch (`redraw`), looked at too. Still there after that,
 * or with no redraw to try: the picture is kept, `textLeft` is set (the board
 * shows WORDS_NOTICE) and picture_text_left is logged.
 *
 *   within  only this part of the picture may change (an area edit's area)
 *   except  this part must never change (a resized picture's original place)
 *   fix     false: only look (after the person's own Erase), change nothing
 *
 * When the vision model can't say (not set up, rate limited, down), the
 * picture goes on as it is: this never stops a picture. That is not the same
 * as "no words": `unchecked` says so, the version records it and the board
 * shows "Words not checked" with a way to check again (PI-20).
 */
export async function keepWordsOut(
  scope: ProjectScope,
  a: {
    context: BrandContext; bytes: Uint8Array; model: string; shape: ImageShape; contentItemId: string; why: string;
    within?: Box | null; except?: PixelRect | null; fix?: boolean;
    redraw?: () => Promise<{ bytes: Uint8Array; model: string }>;
  },
): Promise<{ bytes: Uint8Array; model: string; textLeft: boolean; unchecked: boolean }> {
  // The check's own context (INV-2: the one builder), the short "check" cut of it.
  const context = await loadBrandContext(scope, "en", undefined, "check");
  // A job has a lease (lib/jobs): no further erase or redraw starts once this has run WORDS_TRY_BUDGET_MS.
  const started = Date.now();
  const late = () => Date.now() - started > WORDS_TRY_BUDGET_MS;
  const look = (bytes: Uint8Array, why: string) => lookForWords(scope, bytes, { context, contentItemId: a.contentItemId, why });
  const base = { tenantId: scope.tenantId, contentItemId: a.contentItemId, why: a.why };
  const found = await look(a.bytes, a.why);
  if (!found) return { bytes: a.bytes, model: a.model, textLeft: false, unchecked: true };
  if (!found.hasText) return { bytes: a.bytes, model: a.model, textLeft: false, unchecked: false };
  logger.info("picture_text_found", { ...base, boxes: found.boxes.map((b) => [b.x, b.y, b.w, b.h].map((n) => Number(n.toFixed(3)))) });
  if (a.fix === false) return { bytes: a.bytes, model: a.model, textLeft: true, unchecked: false };

  let now = { bytes: a.bytes, model: a.model };
  const boxes = a.within ? boxesWithin(found.boxes, a.within) : found.boxes;
  if (boxes.length) {
    try {
      const meta = await sharp(Buffer.from(a.bytes)).metadata();
      const width = meta.width ?? 0, height = meta.height ?? 0;
      let erased = 0;
      // One erase per group of nearby words, each on the result of the one before;
      // each changes only its own boxes, so outside all of them the picture is its own.
      for (const group of width && height ? wordGroups(boxes) : []) {
        if (erased && late()) break;
        const mask = await boxesMask(group, width, height, a.except);
        if (!(await maskHasArea(mask))) continue;
        const smallest = Math.min(...group.map((b) => Math.min(b.w * width, b.h * height)));
        const feather = Math.max(1, Math.min(ERASE_FEATHER, Math.round(smallest / 6)));
        // No "nothing removed" retry here: the vision model's second look is the judge.
        now = await eraseArea(scope, { context: a.context, bytes: now.bytes, mask, shape: a.shape, contentItemId: a.contentItemId, feather, area: null, minChange: 0, words: true });
        erased++;
      }
      if (erased) {
        const again = await look(now.bytes, `${a.why}, after its words were erased`);
        if (!again || !again.hasText) {
          logger.info("picture_text_erased", { ...base, erases: erased, checked: !!again });
          // Erased, but not looked at again: the board says the words were not checked.
          return { ...now, textLeft: false, unchecked: !again };
        }
      }
    } catch (e) {
      logger.info("picture_text_erase_failed", { ...base, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  if (a.redraw && !late()) {
    try {
      const fresh = await a.redraw();
      const third = await look(fresh.bytes, `${a.why}, drawn again`);
      if (!third || !third.hasText) {
        logger.info("picture_text_redrawn", { ...base, checked: !!third });
        return { bytes: fresh.bytes, model: fresh.model, textLeft: false, unchecked: !third };
      }
      now = fresh;
    } catch (e) {
      logger.info("picture_text_redraw_failed", { ...base, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  logger.info("picture_text_left", base);
  return { ...now, textLeft: true, unchecked: false };
}

/**
 * Said when an area change ran into the area's edge twice (PI-18, PI-19): what
 * was drawn would have been cut off flat along it, so it is not kept.
 */
export const AREA_EDGE_REFUSED = "The change ran past the edge of the marked area, so it would have been cut off there. It wasn't kept. Drag a bigger box around the spot and try again.";

async function redrawAreaNow(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, edit: AreaEdit): Promise<{ id: string; attached: boolean }> {
  const now = await currentPicture(scope, contentItemId, artboard);
  const { piece, ref, row: current, bytes, width, height } = now;
  // A cut-out is a subject on nothing: an edit would draw a background back in. v1 says no, plainly.
  if (now.cutout) throw new PictureError(CUTOUT_LOCKED);
  const kind: PinKind = edit.kind === "markup" || edit.kind === "erase" ? edit.kind : "comment";
  const strokes = kind === "comment" ? [] : cleanStrokes(edit.strokes);
  const shape = current.params?.shape ?? shapeFor(artboard, piece.format);
  const context = await loadBrandContext(scope, "en", formatByKey(piece.format).platform, "write");
  const wordsRule = ref.mode === "with_text" && current.params?.heading
    ? `Any text in the area must read exactly as asked; elsewhere the text stays "${current.params.heading}".`
    : "No words, letters or logos.";
  const keep = (merged: Uint8Array, prompt: string, model: string, op: PictureOp, words?: { textLeft?: boolean; unchecked?: boolean } | null) =>
    commitPicture(scope, piece, merged, {
      artboard, mode: ref.mode, shape, prompt: current.prompt ?? prompt, model,
      avoid: current.params?.avoid, heading: current.params?.heading ?? null, parentId: current.id, op,
      textLeft: words?.textLeft, wordsUnchecked: words?.unchecked,
    }, ref.id);
  const live = ref.mode === "live_text";

  if (kind === "erase") {
    if (strokes.length === 0) throw new PictureError("Brush over what to erase first.");
    const mask = await strokeMask(strokes, width, height);
    const thinnest = Math.min(...strokes.map((s) => s.w)) * Math.min(width, height);
    const feather = Math.max(1, Math.min(ERASE_FEATHER, Math.round(thinnest / 4)));
    const erased = await eraseArea(scope, { context, bytes, mask, shape, contentItemId, feather, area: strokesBox(strokes, 0, width / height), thin: (await brushedSpan(mask)) <= ERASE_THIN_SPAN });
    // Erasing words is what the board's notice asks for: looked at again (never
    // changed outside the brush), so the notice goes only when they are gone.
    const words = live ? await keepWordsOut(scope, { context, bytes: erased.bytes, model: erased.model, shape, contentItemId, why: "a picture after an erase", fix: false }) : null;
    return keep(erased.bytes, ERASE_PROMPT, erased.model, "erase", words);
  } else {
    // Markup: the area is the padded box around the marks; with nothing drawn, the box that came with it.
    const marked = kind === "markup" && strokes.length > 0;
    const first = (marked ? strokesBox(strokes, MARKUP_PAD, width / height) : null) ?? cleanBox(edit.box);
    if (!first) throw new PictureError("Mark a bigger area to change.");
    let box: Box = first;
    // A one-click pin: the area is sized to the thing that was clicked (its patch of colour
    // around the point), so a change to all of it fits. A dragged box stays exactly as drawn.
    if (edit.auto && !marked) {
      const thing = await objectBoxAt(bytes, { x: first.x + first.w / 2, y: first.y + first.h / 2 }).catch(() => null);
      if (thing) box = unionBox(first, thing);
    }
    let mask = await regionMask(box, width, height);
    const prompt = [
      `Change only the marked area: ${edit.note.replace(/\s+/g, " ").trim().slice(0, 500)}`,
      "Keep everything else exactly as it is: the same subject, style, light and colours.",
      current.prompt ? `The picture: ${current.prompt.slice(0, 1500)}` : "",
      wordsRule,
    ].filter(Boolean).join("\n");
    const marks = marked ? await strokesOverlay(strokes, width, height, MARKS_COLOUR) : undefined;
    const ask = (p: string, withMarks: boolean) => editImage(scope, { context, prompt: p, source: bytes, mask, shape, contentItemId, intent: "area", ...(withMarks && marks ? { marks } : {}) });
    let answer = await ask(prompt, !!marks);
    if (process.env.NODE_ENV === "development") {
      // Dev only: the model's whole answer, so the blend at the area's edge can be judged against it.
      await storage().put(tenantKey(scope.tenantId!, "debug", `area-${Date.now()}.png`), answer.bytes, "image/png").catch(() => undefined);
    }
    let merged = await keepOutside(bytes, answer.bytes, box);
    // A model that copies the marks into the picture gets one more go without
    // them (the note and the area still say what to do); never saved with marks.
    if (marks && (await marksLeft(bytes, merged, box)) > MARKS_LEFT_MAX) {
      answer = await ask(prompt, false);
      merged = await keepOutside(bytes, answer.bytes, box);
      if ((await marksLeft(bytes, merged, box)) > MARKS_LEFT_MAX) {
        throw new PictureError("The change came back with your marks still in it, so it wasn't kept. Try again.");
      }
    }
    // The change must sit inside the area (PI-18, PI-19): what the model drew
    // across the area's edge would be cut off flat there. One more go, told to
    // keep it whole and inside; still across the edge, it is refused plainly.
    // Everything outside the area stays the original either way.
    let cut = await cutAtEdge(bytes, answer.bytes, box);
    if (cut > EDGE_CUT_LIMIT) {
      logger.info("picture_area_rejected", { tenantId: scope.tenantId, model: answer.model, cut: Number(cut.toFixed(3)), attempt: 0 });
      // A one-click pin has no edge the person chose (2026-11-19 QA: a click on a large
      // block, "make this orange", was refused twice and still used 2 pictures). Its
      // second try works on a wider area around the same point, so the whole thing fits.
      // A dragged box is theirs: it is never widened, and the model is asked to stay inside.
      const widen = !!edit.auto && !marked && (box.w < 1 || box.h < 1);
      if (widen) {
        box = growBox(box, AUTO_AREA_GROW);
        mask = await regionMask(box, width, height);
      }
      const inside = widen
        ? prompt
        : prompt.replace(/^(Change only the marked area: [^\n]*)/, "$1 Draw it whole and small enough to sit well inside the middle, with nothing touching the edges.");
      answer = await ask(inside, false);
      merged = await keepOutside(bytes, answer.bytes, box);
      cut = await cutAtEdge(bytes, answer.bytes, box);
      if (cut > EDGE_CUT_LIMIT) {
        logger.info("picture_area_rejected", { tenantId: scope.tenantId, model: answer.model, cut: Number(cut.toFixed(3)), attempt: 1 });
        throw new PictureError(AREA_EDGE_REFUSED);
      }
    }
    let model: string = answer.model;
    // Under live text: words the model drew into the area are erased (only inside the area, so
    // everything outside it is still the original). Words elsewhere are flagged, never touched.
    let words: { textLeft: boolean; unchecked: boolean } | null = null;
    if (live) {
      const w = await keepWordsOut(scope, { context, bytes: merged, model, shape, contentItemId, why: "a picture with one area changed", within: box });
      ({ bytes: merged, model } = w);
      words = w;
    }
    return keep(merged, prompt, model, marked ? "markup" : "area", words);
  }
}

// ---- Resize ------------------------------------------------------------------------------

/** The flat colour the new area is filled with before the model draws it (and what the model is told to fill). */
export const EXTEND_MATTE = "#00ff00";
/** Above this (lib/visual/region driftOf) the model moved the original, and its answer is not kept. */
export const DRIFT_LIMIT = 0.05;
/**
 * Above this (lib/visual/region seamOf) the join between the original and the
 * drawn area shows as a line, and the answer is not kept. Live: a visible
 * join measured 0.29; a smooth one 0.004; a picture's own texture 0.01.
 */
export const SEAM_LIMIT = 0.06;
/** How many times the extend model is asked before a resize is refused (each try is one paid picture). */
export const EXTEND_TRIES = 3;
/** No further try starts after this long (a job's lease is 330 s; one extend call takes 20-60 s). */
const EXTEND_TRY_BUDGET_MS = 180_000;
/** A crop smaller than this on its shorter side is refused: it would be drawn blurry. */
const MIN_CROP_SIDE = 256;

/** The canvas for a new shape: about a megapixel, both sides multiples of 16 (what the image models take). */
export function canvasFor(ratio: number): { width: number; height: number } {
  const h = Math.sqrt(1024 * 1024 / ratio);
  const to16 = (n: number) => Math.max(256, Math.round(n / 16) * 16);
  return { width: to16(h * ratio), height: to16(h) };
}

const shapeOfRatio = (ratio: number): ImageShape => (ratio > 1.15 ? "landscape" : ratio < 1 / 1.15 ? "portrait" : "square");

export interface ResizePlan {
  ratio: number;
  /** Where the picture sits in the new frame, its height worked out from its own shape. */
  place: Box;
  /** The frame is fully covered: a crop, no model call. */
  crop: boolean;
  /** crop: the part of the picture that is kept, in its own pixels. */
  cut: PixelRect;
  /** extend: the canvas and where the picture sits on it, in pixels. */
  canvas: { width: number; height: number };
  placePx: PixelRect;
}

/**
 * Work out a resize from what the board sent and the picture's own size.
 * Refuses (PictureError) a shape or a placing that can't be used: outside
 * RESIZE_RATIO, the picture outside the frame, a crop that is too small or
 * changes nothing, or a frame the picture covers too little of.
 */
export function planResize(input: ResizeInput, width: number, height: number): ResizePlan {
  const ratio = Number(input?.ratio);
  if (!Number.isFinite(ratio) || ratio < RESIZE_RATIO.min || ratio > RESIZE_RATIO.max) throw new PictureError("That shape is too tall or too wide for a picture.");
  const x = Number(input?.place?.x);
  const y = Number(input?.place?.y);
  const w = Number(input?.place?.w);
  if (![x, y, w].every(Number.isFinite) || w < 0.05 || w > 8 || Math.abs(x) > 8 || Math.abs(y) > 8) throw new PictureError("Place the picture inside the new frame first.");
  // The picture keeps its own shape: its height in the frame follows from its width there.
  const h = (w * ratio) / (width / height);
  const place = { x, y, w, h };
  if (x >= 1 || y >= 1 || x + w <= 0 || y + h <= 0) throw new PictureError("Place the picture inside the new frame first.");

  // Crop: the frame, in the picture's own pixels.
  const cutLeft = Math.min(width - 1, Math.max(0, Math.round((-x / w) * width)));
  const cutTop = Math.min(height - 1, Math.max(0, Math.round((-y / h) * height)));
  const cut = {
    left: cutLeft,
    top: cutTop,
    width: Math.max(1, Math.min(width - cutLeft, Math.round(width / w))),
    height: Math.max(1, Math.min(height - cutTop, Math.round(height / h))),
  };
  const canvas = canvasFor(ratio);
  const placePx = {
    left: Math.round(x * canvas.width),
    top: Math.round(y * canvas.height),
    width: Math.max(1, Math.round(w * canvas.width)),
    height: Math.max(1, Math.round(h * canvas.height)),
  };
  const crop = coversFrame(place);
  if (crop) {
    if (cut.width === width && cut.height === height) throw new PictureError("The picture already has that shape.");
    if (Math.min(cut.width, cut.height) < MIN_CROP_SIDE) throw new PictureError("That crop is too small to stay sharp. Zoom out a little.");
  } else {
    const seen = visiblePart(placePx, canvas);
    const cover = seen ? (seen.width * seen.height) / (canvas.width * canvas.height) : 0;
    if (cover < MIN_EXTEND_COVER) throw new PictureError("Draw a new picture in this shape instead.");
  }
  return { ratio, place, crop, cut, canvas, placePx };
}

const NOT_WITH_TEXT = "This picture has its heading drawn in, so it can't be reshaped. Draw one without the heading first.";

/** The checks a resize makes before any work, and its plan. */
async function resizeOf(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, input: ResizeInput): Promise<{ now: CurrentPicture; plan: ResizePlan }> {
  const now = await currentPicture(scope, contentItemId, artboard);
  if (now.cutout) throw new PictureError(CUTOUT_LOCKED);
  if (now.ref.mode === "with_text") throw new PictureError(NOT_WITH_TEXT);
  return { now, plan: planResize(input, now.width, now.height) };
}

/**
 * Whether this resize is a crop (done at once, free) or needs the image model
 * to draw the extra area (queued, one picture). Refuses plainly what can't be
 * done, before anything is queued.
 */
export async function resizeKind(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, input: ResizeInput): Promise<"crop" | "extend"> {
  return (await resizeOf(scope, contentItemId, artboard, input)).plan.crop ? "crop" : "extend";
}

/**
 * Give a visual's picture a new shape. Where the picture covers the whole new
 * frame it is cropped (no model call, nothing logged, nothing charged).
 * Otherwise it is set on a flat matte in the new frame, the image model fills
 * the matte, and the original is pasted back over its place, so the only new
 * pixels are the ones outside it. Returns the new version's id.
 */
export async function resizePicture(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, input: ResizeInput, run?: PictureRun): Promise<string> {
  return oneAtATime(scope, contentItemId, artboard, () => budgeted(PICTURE_BUDGET.extend, run, () => resizePictureNow(scope, contentItemId, artboard, input)));
}

async function resizePictureNow(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, input: ResizeInput): Promise<{ id: string; attached: boolean }> {
  const { now, plan } = await resizeOf(scope, contentItemId, artboard, input);
  const { piece, ref, row: current, bytes } = now;
  const shape = shapeOfRatio(plan.ratio);
  const keep = (png: Uint8Array, model: string, words: { textLeft: boolean; unchecked: boolean }) =>
    commitPicture(scope, piece, png, {
      artboard, mode: ref.mode, shape, prompt: current.prompt ?? "", model,
      avoid: current.params?.avoid, heading: null, parentId: current.id, op: "resize", textLeft: words.textLeft, wordsUnchecked: words.unchecked,
    }, ref.id);

  if (plan.crop) {
    const cut = new Uint8Array(await sharp(Buffer.from(bytes)).extract(plan.cut).png().toBuffer());
    // A crop draws nothing: words the picture was flagged for (or not checked for) may still be in the part kept.
    return keep(cut, "crop", { textLeft: current.params?.textLeft === true, unchecked: current.params?.wordsUnchecked === true });
  } else {
    const { canvas, placePx } = plan;
    const source = await placeOnCanvas(bytes, canvas, placePx, EXTEND_MATTE);
    // The mask: the matte may change, the picture's own place may not.
    const seen = visiblePart(placePx, canvas)!;
    const raw = Buffer.alloc(canvas.width * canvas.height * 4);
    for (let y = seen.top; y < seen.top + seen.height; y++) {
      for (let x = seen.left; x < seen.left + seen.width; x++) raw[(y * canvas.width + x) * 4 + 3] = 255;
    }
    const mask = new Uint8Array(await sharp(raw, { raw: { width: canvas.width, height: canvas.height, channels: 4 } }).png().toBuffer());
    const context = await loadBrandContext(scope, "en", formatByKey(piece.format).platform, "write");
    const prompt = [
      "Fill the solid green area so it continues the scene naturally. Do not change, move or resize anything that is not green.",
      current.prompt ? `The picture: ${current.prompt.slice(0, 1500)}` : "",
      "No text, letters or logos.",
    ].filter(Boolean).join("\n");

    let answer: Uint8Array | null = null;
    let model = "";
    let problem = "";
    const started = Date.now();
    // More goes when the answer can't be used: the model moved the picture,
    // left the matte, or drew the new area with a visible join to the
    // original (live, about one try in two drifted). No new try starts
    // once EXTEND_TRY_BUDGET_MS has gone, so the job stays inside its lease.
    for (let attempt = 0; attempt < EXTEND_TRIES && !answer; attempt++) {
      if (attempt > 0 && Date.now() - started > EXTEND_TRY_BUDGET_MS) break;
      const out = await editImage(scope, { context, prompt, source, mask, shape, contentItemId, intent: "extend" });
      const sized = new Uint8Array(await sharp(Buffer.from(out.bytes)).resize(canvas.width, canvas.height, { fit: "fill" }).png().toBuffer());
      model = out.model;
      const drift = await driftOf(sized, bytes, placePx);
      const matte = drift > DRIFT_LIMIT ? 0 : await matteLeft(sized, seen);
      const merged = drift > DRIFT_LIMIT || matte > 0.03 ? null : await keepOriginal(sized, bytes, placePx);
      const seam = merged ? await seamOf(merged, placePx) : 0;
      if (drift > DRIFT_LIMIT) problem = "The picture came back shifted, so it was not kept. Try again.";
      else if (matte > 0.03) problem = "The new area came back empty, so it was not kept. Try again.";
      else if (seam > SEAM_LIMIT) problem = "The new area came back with a visible join, so it was not kept. Try again.";
      else answer = merged;
      if (!answer) {
        // What was measured, so a refusal can be judged (stdout, never the picture).
        logger.info("picture_extend_rejected", { tenantId: scope.tenantId, model, drift: Number(drift.toFixed(4)), matte: Number(matte.toFixed(4)), seam: Number(seam.toFixed(4)), attempt });
        if (process.env.NODE_ENV === "development") {
          await storage().put(tenantKey(scope.tenantId!, "debug", `extend-${Date.now()}-${attempt}.png`), sized, "image/png").catch(() => undefined);
        }
      }
    }
    if (!answer) throw new PictureError(problem);
    // Words drawn into the new area are erased there; the original's place is never touched.
    const words = await keepWordsOut(scope, { context, bytes: answer, model, shape, contentItemId, why: "a picture with new area drawn around it", except: seen });
    return keep(words.bytes, words.model, words);
  }
}

/** The share of the new area (everything outside `kept`) that is still the matte's flat green. */
async function matteLeft(png: Uint8Array, kept: PixelRect): Promise<number> {
  const { data, info } = await sharp(Buffer.from(png)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let area = 0;
  let green = 0;
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      if (x >= kept.left && x < kept.left + kept.width && y >= kept.top && y < kept.top + kept.height) continue;
      area++;
      const i = (y * info.width + x) * 3;
      if (data[i + 1] > 215 && data[i] < 70 && data[i + 2] < 70) green++;
    }
  }
  return area ? green / area : 0;
}

// ---- Remove background ----------------------------------------------------------------------

/**
 * Remove the background of a visual's picture: the subject on nothing, a PNG
 * with alpha, kept as a new version (the one before is still there, one Undo
 * away). The visual then shows it on its own ground colour. Refused, plainly,
 * where it would not work: the heading drawn into the picture, a picture that
 * is already a cut-out, or one with no clear subject.
 */
export async function cutOutPicture(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, run?: PictureRun): Promise<string> {
  // Free (the model runs here): no budget of its own, but the same report of whether it attached.
  return oneAtATime(scope, contentItemId, artboard, async () => {
    const out = await cutOutPictureNow(scope, contentItemId, artboard);
    if (run) run.attached = out.attached;
    return out.id;
  });
}

/** The refusals a cut-out makes before any work (so the action can say no at once, without queueing). */
export async function cutOutRefusal(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind): Promise<string | null> {
  const status = cutoutStatus();
  if (!status.available) return status.reason;
  try {
    const now = await currentPicture(scope, contentItemId, artboard);
    if (now.cutout) return "This picture already has its background removed.";
    if (now.ref.mode === "with_text") return "This picture has its heading drawn in, so its background can't be removed. Draw one without the heading first.";
    return null;
  } catch (e) {
    if (e instanceof PictureError) return e.message;
    throw e;
  }
}

/**
 * A cut-out cropped to its subject: the box around every pixel that is not
 * (almost) transparent, grown by `pad` of the subject's longer side and kept
 * inside the picture. A picture with nothing solid comes back as it was.
 */
export async function trimToSubject(png: Uint8Array, pad = 0.04): Promise<Uint8Array> {
  const img = sharp(Buffer.from(png)).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + channels - 1] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return png;
  const p = Math.round(Math.max(x1 - x0, y1 - y0) * pad);
  const left = Math.max(0, x0 - p), top = Math.max(0, y0 - p);
  const right = Math.min(width, x1 + 1 + p), bottom = Math.min(height, y1 + 1 + p);
  if (left === 0 && top === 0 && right === width && bottom === height) return png;
  const out = await sharp(Buffer.from(png)).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
  return new Uint8Array(out);
}

/**
 * A cut-out already made from this very picture (Back, then Remove background
 * again): it is the same subject on nothing, so it is put back instead of
 * making an identical new version (PI-25).
 */
async function cutoutOf(scope: ProjectScope, parentId: string, artboard: ArtboardKind): Promise<string | null> {
  return (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string }>(
        `SELECT id FROM image_assets
          WHERE parent_id=$1 AND project_id=$2 AND kind='picture' AND storage_key IS NOT NULL
            AND params->>'cutout' = 'true' AND params->>'artboard' = $3
          ORDER BY created_at DESC LIMIT 1`,
        [parentId, scope.projectId, artboard],
      ),
    )
  ).rows[0]?.id ?? null;
}

async function cutOutPictureNow(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind): Promise<{ id: string; attached: boolean }> {
  const refusal = await cutOutRefusal(scope, contentItemId, artboard);
  if (refusal) throw new PictureError(refusal);
  const { piece, ref, row: current, bytes } = await currentPicture(scope, contentItemId, artboard);
  const earlier = await cutoutOf(scope, current.id, artboard);
  if (earlier) {
    const attached = await withTenantSession(scope, (c) => pointAt(c, scope, contentItemId, artboard, { id: earlier, mode: ref.mode, cutout: true }, ref.id));
    logger.info("picture_cutout_reused", { tenantId: scope.tenantId, contentItemId, artboard, id: earlier });
    return { id: earlier, attached };
  }
  const out = await cutoutImage(scope, { source: bytes, contentItemId });
  if (!clearSubject(out.coverage)) throw new PictureError("There's no clear subject to cut out in this picture.");
  // Only the subject is kept (with a little room): the empty frame around it
  // would make it small on the visual (2026-11-18: the scales filled a fifth of their space).
  const trimmed = await trimToSubject(out.bytes);
  return commitPicture(scope, piece, trimmed, {
    artboard, mode: ref.mode, shape: current.params?.shape ?? shapeFor(artboard, piece.format), prompt: current.prompt ?? "", model: out.model,
    avoid: current.params?.avoid, heading: null, parentId: current.id, op: "cutout", cutout: true,
  }, ref.id);
}

/** Undo the last area change: the visual goes back to the version it was made from. */
export async function previousPicture(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind): Promise<boolean> {
  const ref = (await designOf(scope, contentItemId))?.pictures[artboard];
  if (!ref) return false;
  const current = await pictureRow(scope, ref.id);
  if (!current?.parent_id) return false;
  const parent = await pictureRow(scope, current.parent_id);
  if (!parent) return false;
  await withTenantSession(scope, async (c) => {
    await c.query("UPDATE image_assets SET is_current=false WHERE id=$1", [current.id]);
    await c.query("UPDATE image_assets SET is_current=true WHERE id=$1", [parent.id]);
  });
  // The version before may be a different kind of picture (the one a cut-out was made from is not a cut-out).
  await attach(scope, contentItemId, artboard, { id: parent.id, mode: ref.mode, cutout: parent.params?.cutout === true });
  return true;
}

/** Take the picture off a visual (back to the template). The picture's versions stay until the visuals are deleted. */
export async function removePicture(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind): Promise<void> {
  await attach(scope, contentItemId, artboard, null);
}

/** Same-origin signed links for the pictures in use, so the board can draw and export them (8 hours). */
export async function pictureLinks(scope: ProjectScope, ids: string[]): Promise<Record<string, string>> {
  const clean = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
  if (!clean.length) return {};
  const rows = (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string; storage_key: string }>(
        "SELECT id, storage_key FROM image_assets WHERE id = ANY($1::uuid[]) AND project_id=$2 AND kind='picture' AND storage_key IS NOT NULL",
        [clean, scope.projectId],
      ),
    )
  ).rows;
  return Object.fromEntries(rows.map((r) => [r.id, appSignedUrl(r.storage_key, 8 * 60 * 60)]));
}

/** How many versions back the current picture goes (for Undo). */
export async function pictureDepth(scope: ProjectScope, id: string): Promise<number> {
  return withTenantSession(scope, async (c) =>
    (
      await c.query<{ n: number }>(
        `WITH RECURSIVE chain AS (
           SELECT id, parent_id, 0 AS n FROM image_assets WHERE id=$1 AND project_id=$2 AND kind='picture'
           UNION ALL SELECT p.id, p.parent_id, chain.n + 1 FROM image_assets p JOIN chain ON p.id = chain.parent_id WHERE chain.n < 50)
         SELECT max(n)::int AS n FROM chain`,
        [id, scope.projectId],
      )
    ).rows[0]?.n ?? 0,
  );
}

/**
 * Point one visual at a specific version of its picture (undo and redo of a
 * picture change). The version must be a picture of this piece, for this
 * visual, in this project.
 */
export async function selectPictureVersion(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, pictureId: string): Promise<boolean> {
  const row = await pictureRow(scope, pictureId);
  if (!row || row.params?.artboard !== artboard) return false;
  const owner = (
    await withTenantSession(scope, (c) => c.query<{ content_item_id: string }>("SELECT content_item_id FROM image_assets WHERE id=$1", [pictureId]))
  ).rows[0]?.content_item_id;
  if (owner !== contentItemId) return false;
  await withTenantSession(scope, async (c) => {
    await c.query("UPDATE image_assets SET is_current=false WHERE content_item_id=$1 AND project_id=$2 AND kind='picture' AND params->>'artboard'=$3", [contentItemId, scope.projectId, artboard]);
    await c.query("UPDATE image_assets SET is_current=true WHERE id=$1", [pictureId]);
  });
  await attach(scope, contentItemId, artboard, { id: pictureId, mode: row.params?.mode === "with_text" ? "with_text" : "live_text", cutout: row.params?.cutout === true });
  return true;
}

/** For the board: each picture in use, its same-origin link (8 hours) and the version it was made from. */
export async function pictureInfo(scope: ProjectScope, ids: string[]): Promise<Record<string, { url: string; parentId: string | null }>> {
  const clean = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
  if (!clean.length) return {};
  const rows = (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string; storage_key: string; parent_id: string | null }>(
        "SELECT id, storage_key, parent_id FROM image_assets WHERE id = ANY($1::uuid[]) AND project_id=$2 AND kind='picture' AND storage_key IS NOT NULL",
        [clean, scope.projectId],
      ),
    )
  ).rows;
  return Object.fromEntries(rows.map((r) => [r.id, { url: appSignedUrl(r.storage_key, 8 * 60 * 60), parentId: r.parent_id }]));
}

/** One version of a visual's picture, as the board lists it. */
export interface PictureVersion {
  id: string;
  contentItemId: string;
  artboard: ArtboardKind;
  mode: PictureMode;
  /** The heading drawn into it ("with_text"), as it read when the picture was drawn. */
  heading: string | null;
  /** The version an area change was made from; null for a fresh draw. */
  parentId: string | null;
  createdAt: string;
  /** Same-origin signed link (8 hours). */
  url: string;
  /** How this version came to be (lib/visual/picture-tools PICTURE_OP_LABEL). */
  op: PictureOp;
  /** The file's size in pixels (0 when it was never recorded). */
  width: number;
  height: number;
  /** The background has been removed: a PNG with alpha. */
  cutout: boolean;
  /** It should have no words and may still show some (keepWordsOut): the board says so. */
  textLeft: boolean;
  /** It should have no words and the check could not run (PI-20): the board says "Words not checked". */
  wordsUnchecked: boolean;
}

const PICTURE_OPS: readonly PictureOp[] = ["draw", "area", "markup", "erase", "resize", "cutout"];

/** How many versions of one visual's picture the board lists (newest first). */
export const MAX_VERSIONS_SHOWN = 12;

/**
 * Every version of every picture in the project, newest first: fresh draws
 * and area changes alike. The board lists them per visual so an earlier
 * picture can be put back after a reload, and reads the heading a picture
 * was drawn with to say when it has gone stale.
 */
export async function pictureVersions(scope: ProjectScope): Promise<PictureVersion[]> {
  const rows = (
    await withTenantSession(scope, (c) =>
      c.query<PictureRow & { content_item_id: string }>(
        `SELECT id, content_item_id, storage_key, prompt, params, parent_id, width, height, created_at FROM image_assets
          WHERE project_id=$1 AND kind='picture' AND storage_key IS NOT NULL AND content_item_id IS NOT NULL
          ORDER BY created_at DESC, id`,
        [scope.projectId],
      ),
    )
  ).rows;
  const ARTBOARD: readonly string[] = ["post", "quote", "carousel"];
  return rows
    .filter((r) => ARTBOARD.includes(String(r.params?.artboard)))
    .map((r) => ({
      id: r.id,
      contentItemId: r.content_item_id,
      artboard: r.params!.artboard!,
      mode: r.params?.mode === "with_text" ? "with_text" : "live_text",
      heading: typeof r.params?.heading === "string" ? r.params.heading : null,
      parentId: r.parent_id,
      createdAt: new Date(r.created_at).toISOString(),
      url: appSignedUrl(r.storage_key, 8 * 60 * 60),
      // Versions made before the op was recorded: a version made from another was an area change.
      op: PICTURE_OPS.includes(r.params?.op as PictureOp) ? (r.params!.op as PictureOp) : r.parent_id ? "area" : "draw",
      width: r.width ?? 0,
      height: r.height ?? 0,
      cutout: r.params?.cutout === true,
      textLeft: r.params?.textLeft === true,
      wordsUnchecked: r.params?.wordsUnchecked === true,
    }));
}

/**
 * "Check for words" on a picture whose words check could not run (PI-20): one
 * look by the vision model (through the facade: capped and logged), nothing in
 * the picture changed. Records the answer on the version: words found (the
 * board says so; Erase removes them), none, or still not checked. Returns
 * which, or null when the visual has no such picture.
 */
export async function checkWords(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind): Promise<"words" | "clean" | "unchecked" | null> {
  const now = await currentPicture(scope, contentItemId, artboard);
  if (now.cutout || now.ref.mode !== "live_text") return null;
  const context = await loadBrandContext(scope, "en", formatByKey(now.piece.format).platform, "write");
  const shape = now.row.params?.shape ?? shapeFor(artboard, now.piece.format);
  const w = await keepWordsOut(scope, { context, bytes: now.bytes, model: "", shape, contentItemId, why: "a picture checked again for words", fix: false });
  const patch = w.unchecked ? { wordsUnchecked: true } : { wordsUnchecked: false, textLeft: w.textLeft };
  await withTenantSession(scope, (c) =>
    c.query("UPDATE image_assets SET params = params || $1::jsonb WHERE id=$2 AND project_id=$3 AND kind='picture'", [JSON.stringify(patch), now.row.id, scope.projectId]),
  );
  return w.unchecked ? "unchecked" : w.textLeft ? "words" : "clean";
}

/**
 * The newest version of a visual's picture made from `from` (null: a fresh
 * draw) since `since` by `op`: a job that is run a second time (its lease ran
 * out, or its worker died after the work was done) finds its own result here
 * instead of paying for it again (PI-29).
 */
export async function madeSince(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, op: PictureOp, from: string | null, since: string): Promise<string | null> {
  if (!isId(contentItemId) || Number.isNaN(Date.parse(since))) return null;
  return (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string }>(
        `SELECT id FROM image_assets
          WHERE content_item_id=$1 AND project_id=$2 AND kind='picture' AND params->>'artboard'=$3 AND params->>'op'=$4
            AND parent_id IS NOT DISTINCT FROM $5::uuid AND created_at >= $6::timestamptz
          ORDER BY created_at DESC LIMIT 1`,
        [contentItemId, scope.projectId, artboard, op, from, since],
      ),
    )
  ).rows[0]?.id ?? null;
}

/** The picture a visual shows now (its version id), or null. */
export async function currentPictureId(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind): Promise<string | null> {
  return (await designOf(scope, contentItemId))?.pictures[artboard]?.id ?? null;
}
