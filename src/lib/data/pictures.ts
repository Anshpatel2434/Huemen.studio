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
import { withTenantSession } from "@/db/session";
import { cutoutImage, editImage, generateImage, runTask } from "@/lib/ai";
import { cutoutStatus } from "@/lib/ai/cutout";
import { imageBrief } from "@/lib/ai/tasks";
import type { ImageShape } from "@/lib/ai/types";
import { loadBrandContext } from "@/lib/context/context-loader";
import { cutAtSentence } from "@/lib/context/cut";
import { formatByKey } from "@/lib/content/formats";
import { appSignedUrl, storage, tenantKey } from "@/lib/storage";
import {
  changeInside, cleanBox, cleanStrokes, driftOf, keepInsideMask, marksLeft, keepOriginal, keepOutside, placeOnCanvas, regionMask, seamOf, strokeMask, strokesBox, strokesOverlay,
  visiblePart, type Box, type PixelRect,
} from "@/lib/visual/region";
import {
  clearSubject, coversFrame, MIN_EXTEND_COVER, RESIZE_RATIO, type PictureOp, type PinKind, type ResizeInput, type Stroke,
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
  params: { artboard?: ArtboardKind; mode?: PictureMode; shape?: ImageShape; heading?: string | null; avoid?: string; op?: PictureOp; cutout?: boolean } | null;
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

/** Store picture bytes and record the row. Model output is kept as drawn (its provenance data included). */
async function savePicture(
  scope: ProjectScope,
  piece: Piece,
  bytes: Uint8Array,
  meta: {
    artboard: ArtboardKind; mode: PictureMode; shape: ImageShape; prompt: string; model: string; avoid?: string; heading: string | null; parentId: string | null;
    /** How this version came to be (lib/visual/picture-tools PictureOp), for the versions strip. */
    op: PictureOp;
    /** The background has been removed: the file is a PNG with alpha. */
    cutout?: boolean;
  },
): Promise<string> {
  const info = await sharp(Buffer.from(bytes)).metadata().catch(() => null);
  if (!info?.width || !info.height || info.format !== "png") throw new PictureError("The picture came back unreadable. Try again.");
  const key = tenantKey(scope.tenantId!, "pictures", `${randomUUID()}.png`);
  await storage().put(key, bytes, "image/png");
  return withTenantSession(scope, async (c) => {
    // One current picture per visual: a brand-new draw (no parent) retires the
    // earlier ones too, not only the version an edit was made from (2026-11-17).
    await c.query(
      "UPDATE image_assets SET is_current=false WHERE content_item_id=$1 AND project_id=$2 AND kind='picture' AND is_current AND params->>'artboard'=$3",
      [piece.id, scope.projectId, meta.artboard],
    );
    return (
      await c.query<{ id: string }>(
        `INSERT INTO image_assets (tenant_id, project_id, content_item_id, kind, prompt, model, params, aspect_ratio, storage_key, width, height, status, created_by, parent_id, is_current)
         VALUES ($1,$2,$3,'picture',$4,$5,$6,$7,$8,$9,$10,'ready',$11,$12,true) RETURNING id`,
        [
          scope.tenantId, scope.projectId, piece.id, meta.prompt, meta.model,
          JSON.stringify({
            artboard: meta.artboard, mode: meta.mode, shape: meta.shape, heading: meta.heading, avoid: meta.avoid ?? "",
            op: meta.op, ...(meta.cutout ? { cutout: true } : {}),
          }),
          `${info.width}:${info.height}`, key, info.width, info.height, scope.userId, meta.parentId,
        ],
      )
    ).rows[0].id;
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

/**
 * One picture change per visual at a time. A draw or an area redraw reads the
 * visual's CURRENT picture, works on it for as long as the image model takes,
 * and then makes its result the current one. Two of them side by side (two
 * comments sent quickly, two workers) would both start from the same version
 * and the second to finish would drop the first one's change. So each takes a
 * Postgres advisory lock named for the piece and the visual, held for the
 * whole change: the second waits, then starts from the first one's result.
 * The lock is the transaction's, so it is let go even if the work throws.
 */
async function oneAtATime<T>(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, work: () => Promise<T>): Promise<T> {
  return withTenantSession(scope, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`picture:${scope.tenantId}:${contentItemId}:${artboard}`]);
    return work();
  });
}

/** Draw a new picture for one visual and make it that visual's picture. Returns its id. */
export async function drawPicture(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, mode: PictureMode): Promise<string> {
  return oneAtATime(scope, contentItemId, artboard, () => drawPictureNow(scope, contentItemId, artboard, mode));
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

async function drawPictureNow(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, mode: PictureMode): Promise<string> {
  const piece = await pieceOf(scope, contentItemId);
  if (!(await designOf(scope, contentItemId))) throw new PictureError("Make the visuals first; a picture goes on one of them.");
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
  const out = await generateImage(scope, { context, prompt, negativePrompt: avoid, shape, contentItemId });
  const id = await savePicture(scope, piece, out.bytes, {
    artboard, mode, shape, prompt, model: out.model, avoid: brief.avoid, heading: mode === "with_text" ? piece.hook : null, parentId: null, op: "draw",
  });
  await attach(scope, contentItemId, artboard, { id, mode });
  return id;
}

/**
 * Redraw one marked area of a visual's current picture, as asked. The model
 * gets the picture, a mask of the area and the note; the result is used only
 * inside the area, so nothing else in the picture can change. Returns the new
 * version's id.
 */
export async function redrawArea(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, edit: AreaEdit): Promise<string>;
export async function redrawArea(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, box: Box, note: string): Promise<string>;
export async function redrawArea(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, boxOrEdit: Box | AreaEdit, note?: string): Promise<string> {
  // The first form is the one that grew (a kind, strokes); the second is how a plain comment has always been sent.
  const edit: AreaEdit = "box" in boxOrEdit ? boxOrEdit : { box: boxOrEdit, note: note ?? "", kind: "comment" };
  return oneAtATime(scope, contentItemId, artboard, () => redrawAreaNow(scope, contentItemId, artboard, edit));
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
}

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

async function redrawAreaNow(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, edit: AreaEdit): Promise<string> {
  const now = await currentPicture(scope, contentItemId, artboard);
  const { piece, ref, row: current, bytes, width, height } = now;
  // A cut-out is a subject on nothing: an edit would draw a background back in. v1 says no, plainly.
  if (now.cutout) throw new PictureError(CUTOUT_LOCKED);
  const kind: PinKind = edit.kind === "markup" || edit.kind === "erase" ? edit.kind : "comment";
  const strokes = kind === "comment" ? [] : cleanStrokes(edit.strokes);
  const shape = current.params?.shape ?? shapeFor(artboard, piece.format);
  const context = await loadBrandContext(scope, "en", formatByKey(piece.format).platform, "write");
  const words = ref.mode === "with_text" && current.params?.heading
    ? `Any text in the area must read exactly as asked; elsewhere the text stays "${current.params.heading}".`
    : "No words, letters or logos.";
  const keep = (merged: Uint8Array, prompt: string, model: string, op: PictureOp) =>
    savePicture(scope, piece, merged, {
      artboard, mode: ref.mode, shape, prompt: current.prompt ?? prompt, model,
      avoid: current.params?.avoid, heading: current.params?.heading ?? null, parentId: current.id, op,
    });

  let id: string;
  if (kind === "erase") {
    if (strokes.length === 0) throw new PictureError("Brush over what to erase first.");
    const mask = await strokeMask(strokes, width, height);
    const prompt = [
      "Change only the marked area: remove what is there and fill it with the surrounding background or surface, continuing its texture, light and colours. Add nothing new.",
      "Keep everything else exactly as it is: the same subject, style, light and colours.",
      "No words, letters or logos.",
    ].join("\n");
    const thinnest = Math.min(...strokes.map((s) => s.w)) * Math.min(width, height);
    const feather = Math.max(1, Math.min(ERASE_FEATHER, Math.round(thinnest / 4)));
    let out = await editImage(scope, { context, prompt, source: bytes, mask, shape, contentItemId, intent: "erase" });
    let merged = await keepInsideMask(bytes, out.bytes, mask, feather);
    // A model that hands the brushed part back as it was removed nothing (live,
    // a rod on a pan, 2026-11-18): one more go, then a plain refusal, never a
    // new version that looks like the old one.
    if ((await changeInside(bytes, merged, mask)) < ERASE_MIN_CHANGE) {
      out = await editImage(scope, { context, prompt, source: bytes, mask, shape, contentItemId, intent: "erase" });
      merged = await keepInsideMask(bytes, out.bytes, mask, feather);
      if ((await changeInside(bytes, merged, mask)) < ERASE_MIN_CHANGE) {
        throw new PictureError("The erase came back with nothing removed, so it wasn't kept. Try brushing a little wider.");
      }
    }
    // Never save a result with the brush paint still in it.
    const area = strokesBox(strokes, 0, width / height);
    if (area && (await marksLeft(bytes, merged, area)) > MARKS_LEFT_MAX) {
      throw new PictureError("The erase came back with the brush marks still in it, so it wasn't kept. Try again, or brush a little wider.");
    }
    id = await keep(merged, prompt, out.model, "erase");
  } else {
    // Markup: the area is the padded box around the marks; with nothing drawn, the box that came with it.
    const marked = kind === "markup" && strokes.length > 0;
    const box = (marked ? strokesBox(strokes, MARKUP_PAD, width / height) : null) ?? cleanBox(edit.box);
    if (!box) throw new PictureError("Mark a bigger area to change.");
    const mask = await regionMask(box, width, height);
    const prompt = [
      `Change only the marked area: ${edit.note.replace(/\s+/g, " ").trim().slice(0, 500)}`,
      "Keep everything else exactly as it is: the same subject, style, light and colours.",
      current.prompt ? `The picture: ${current.prompt.slice(0, 1500)}` : "",
      words,
    ].filter(Boolean).join("\n");
    const marks = marked ? await strokesOverlay(strokes, width, height, MARKS_COLOUR) : undefined;
    const out = await editImage(scope, { context, prompt, source: bytes, mask, shape, contentItemId, intent: "area", ...(marks ? { marks } : {}) });
    if (process.env.NODE_ENV === "development") {
      // Dev only: the model's whole answer, so the blend at the area's edge can be judged against it.
      await storage().put(tenantKey(scope.tenantId!, "debug", `area-${Date.now()}.png`), out.bytes, "image/png").catch(() => undefined);
    }
    let merged = await keepOutside(bytes, out.bytes, box);
    let model = out.model;
    // A model that copies the marks into the picture gets one more go without
    // them (the note and the area still say what to do); never saved with marks.
    if (marks && (await marksLeft(bytes, merged, box)) > MARKS_LEFT_MAX) {
      const again = await editImage(scope, { context, prompt, source: bytes, mask, shape, contentItemId, intent: "area" });
      merged = await keepOutside(bytes, again.bytes, box);
      model = again.model;
      if ((await marksLeft(bytes, merged, box)) > MARKS_LEFT_MAX) {
        throw new PictureError("The change came back with your marks still in it, so it wasn't kept. Try again.");
      }
    }
    id = await keep(merged, prompt, model, marked ? "markup" : "area");
  }
  await attach(scope, contentItemId, artboard, { id, mode: ref.mode });
  return id;
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
export async function resizePicture(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, input: ResizeInput): Promise<string> {
  return oneAtATime(scope, contentItemId, artboard, () => resizePictureNow(scope, contentItemId, artboard, input));
}

async function resizePictureNow(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, input: ResizeInput): Promise<string> {
  const { now, plan } = await resizeOf(scope, contentItemId, artboard, input);
  const { piece, ref, row: current, bytes } = now;
  const shape = shapeOfRatio(plan.ratio);
  const keep = (png: Uint8Array, model: string) =>
    savePicture(scope, piece, png, {
      artboard, mode: ref.mode, shape, prompt: current.prompt ?? "", model,
      avoid: current.params?.avoid, heading: null, parentId: current.id, op: "resize",
    });

  let id: string;
  if (plan.crop) {
    const cut = new Uint8Array(await sharp(Buffer.from(bytes)).extract(plan.cut).png().toBuffer());
    id = await keep(cut, "crop");
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
    id = await keep(answer, model);
  }
  await attach(scope, contentItemId, artboard, { id, mode: ref.mode });
  return id;
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
export async function cutOutPicture(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind): Promise<string> {
  return oneAtATime(scope, contentItemId, artboard, () => cutOutPictureNow(scope, contentItemId, artboard));
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

async function cutOutPictureNow(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind): Promise<string> {
  const refusal = await cutOutRefusal(scope, contentItemId, artboard);
  if (refusal) throw new PictureError(refusal);
  const { piece, ref, row: current, bytes } = await currentPicture(scope, contentItemId, artboard);
  const out = await cutoutImage(scope, { source: bytes, contentItemId });
  if (!clearSubject(out.coverage)) throw new PictureError("There's no clear subject to cut out in this picture.");
  // Only the subject is kept (with a little room): the empty frame around it
  // would make it small on the visual (2026-11-18: the scales filled a fifth of their space).
  const trimmed = await trimToSubject(out.bytes);
  const id = await savePicture(scope, piece, trimmed, {
    artboard, mode: ref.mode, shape: current.params?.shape ?? shapeFor(artboard, piece.format), prompt: current.prompt ?? "", model: out.model,
    avoid: current.params?.avoid, heading: null, parentId: current.id, op: "cutout", cutout: true,
  });
  await attach(scope, contentItemId, artboard, { id, mode: ref.mode, cutout: true });
  return id;
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
    }));
}
