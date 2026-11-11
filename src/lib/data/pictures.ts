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
import { formatByKey } from "@/lib/content/formats";
import { appSignedUrl, storage, tenantKey } from "@/lib/storage";
import { keepOutside, regionMask, type Box } from "@/lib/visual/region";
import { parseDesign, type ArtboardKind, type Design, type PictureMode } from "@/lib/visual/design";
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
}

async function pieceOf(scope: ProjectScope, contentItemId: string): Promise<Piece> {
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<Piece>("SELECT id, format, hook, body FROM content_items WHERE id=$1 AND project_id=$2", [contentItemId, scope.projectId]),
    )
  ).rows[0];
  if (!row) throw new PictureError("That piece isn't in this project any more.");
  return row;
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
    if (meta.parentId) await c.query("UPDATE image_assets SET is_current=false WHERE id=$1", [meta.parentId]);
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

/** The code-owned lines about words in the picture: none, or exactly the heading. */
export function pictureInstructions(mode: PictureMode, heading: string): string {
  return mode === "with_text"
    ? [`Text: "${heading.replace(/"/g, "'").slice(0, 120)}"`, "Show this text exactly once, spelled exactly as given, large and legible, in a clean sans-serif. No other words, letters or logos."].join("\n")
    : "No words, letters, numbers or logos anywhere in the picture. Leave calm, uncluttered space where a headline will sit on top.";
}

/** Draw a new picture for one visual and make it that visual's picture. Returns its id. */
export async function drawPicture(scope: ProjectScope, contentItemId: string, artboard: ArtboardKind, mode: PictureMode): Promise<string> {
  const piece = await pieceOf(scope, contentItemId);
  if (!(await designOf(scope, contentItemId))) throw new PictureError("Make the visuals first; a picture goes on one of them.");
  const fmt = formatByKey(piece.format);
  const shape = shapeFor(artboard, piece.format);
  const context = await loadBrandContext(scope, "en", fmt.platform, "write");
  const brief = await runTask(scope, imageBrief, {
    context,
    contentItemId,
    route: "cheap",
    taskInput: [
      `Format: ${fmt.label}`,
      `Visual: ${artboard === "post" ? "post image" : artboard === "quote" ? "quote card" : "carousel cover"}`,
      `Shape: ${shape}`,
      `Piece: ${piece.hook.replace(/\s+/g, " ").slice(0, 300)}`,
      mode === "with_text" ? `Text to show: ${piece.hook.replace(/\s+/g, " ").slice(0, 120)}` : "Leave space: lower third",
    ].join("\n"),
  });
  const prompt = `${brief.scene.trim()}\n\n${pictureInstructions(mode, piece.hook)}`;
  const out = await generateImage(scope, { context, prompt, negativePrompt: brief.avoid, shape, contentItemId });
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
      ? `Any text in the area must read exactly as asked; elsewhere the text stays "${current.params.heading.slice(0, 120)}".`
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
