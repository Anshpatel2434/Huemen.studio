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
 *   previousPicture / removePicture / pictureLinks / pictureVersions
 *
 * Slow calls run in the job queue (lib/jobs kinds picture_generate and
 * picture_edit); these functions are what the jobs call.
 *
 * Server-only.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { withTenantSession } from "@/db/session";
import { editImage, generateImage, runTask } from "@/lib/ai";
import { imageBrief } from "@/lib/ai/tasks";
import type { ImageShape } from "@/lib/ai/types";
import { loadBrandContext } from "@/lib/context/context-loader";
import { cutAtSentence } from "@/lib/context/cut";
import { formatByKey } from "@/lib/content/formats";
import { appSignedUrl, storage, tenantKey } from "@/lib/storage";
import { keepOutside, regionMask, type Box } from "@/lib/visual/region";
import { parseDesign, type ArtboardKind, type Design, type PictureMode } from "@/lib/visual/design";
import { schemeIndex, schemesFrom, type Scheme } from "@/lib/visual/schemes";
import { stripMarkers } from "@/lib/visual/markers";
import { loadFoundation } from "@/lib/data/foundation";
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
async function attach(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, ref: { id: string; mode: PictureMode } | null): Promise<void> {
  const design = await designOf(scope, contentItemId);
  if (!design) throw new PictureError("Make the visuals first; a picture goes on one of them.");
  const pictures = { ...design.pictures };
  if (ref) pictures[artboard] = ref;
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
  params: { artboard?: ArtboardKind; mode?: PictureMode; shape?: ImageShape; heading?: string | null; avoid?: string } | null;
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
  meta: { artboard: ArtboardKind; mode: PictureMode; shape: ImageShape; prompt: string; model: string; avoid?: string; heading: string | null; parentId: string | null },
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
          JSON.stringify({ artboard: meta.artboard, mode: meta.mode, shape: meta.shape, heading: meta.heading, avoid: meta.avoid ?? "" }),
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
    artboard, mode, shape, prompt, model: out.model, avoid: brief.avoid, heading: mode === "with_text" ? piece.hook : null, parentId: null,
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
export async function redrawArea(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, box: Box, note: string): Promise<string> {
  return oneAtATime(scope, contentItemId, artboard, () => redrawAreaNow(scope, contentItemId, artboard, box, note));
}

async function redrawAreaNow(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, box: Box, note: string): Promise<string> {
  const piece = await pieceOf(scope, contentItemId);
  const ref = (await designOf(scope, contentItemId))?.pictures[artboard];
  if (!ref) throw new PictureError("That visual has no picture to change.");
  const current = await pictureRow(scope, ref.id);
  if (!current) throw new PictureError("That picture isn't there any more. Draw a new one.");
  const obj = await storage().get(current.storage_key);
  if (!obj) throw new PictureError("That picture's file is missing. Draw a new one.");
  const meta = await sharp(Buffer.from(obj.data)).metadata();
  if (!meta.width || !meta.height) throw new PictureError("That picture couldn't be read.");

  const mask = await regionMask(box, meta.width, meta.height);
  const shape = current.params?.shape ?? shapeFor(artboard, piece.format);
  const context = await loadBrandContext(scope, "en", formatByKey(piece.format).platform, "write");
  const prompt = [
    `Change only the marked area: ${note.replace(/\s+/g, " ").trim().slice(0, 500)}`,
    "Keep everything else exactly as it is: the same subject, style, light and colours.",
    current.prompt ? `The picture: ${current.prompt.slice(0, 1500)}` : "",
    ref.mode === "with_text" && current.params?.heading
      ? `Any text in the area must read exactly as asked; elsewhere the text stays "${current.params.heading}".`
      : "No words, letters or logos.",
  ].filter(Boolean).join("\n");
  const out = await editImage(scope, { context, prompt, source: obj.data, mask, shape, contentItemId });
  const merged = await keepOutside(obj.data, out.bytes, box);
  const id = await savePicture(scope, piece, merged, {
    artboard, mode: ref.mode, shape, prompt: current.prompt ?? prompt, model: out.model,
    avoid: current.params?.avoid, heading: current.params?.heading ?? null, parentId: current.id,
  });
  await attach(scope, contentItemId, artboard, { id, mode: ref.mode });
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
  await attach(scope, contentItemId, artboard, { id: parent.id, mode: ref.mode });
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
  await attach(scope, contentItemId, artboard, { id: pictureId, mode: row.params?.mode === "with_text" ? "with_text" : "live_text" });
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
}

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
    }));
}
