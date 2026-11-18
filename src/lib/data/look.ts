/**
 * Reading the person's reference designs ("add up to 3 designs that look like
 * you"), and adding one from a link.
 *
 * readLook: every current reference design, in one vision call (look_read,
 * through the facade, so the cap, retry, template and generation_logs row all
 * apply). The colours are measured here from the pixels (lib/visual/look-read)
 * and passed to the model as facts; the brand context comes from the one
 * builder (INV-2). The reading is stored on visual_identities.core.look, and
 * the empty layout / motifs / photo style fields are seeded from it (never
 * what the person typed). From there it reaches every prompt through
 * visualCoreLines.
 *
 * addReferenceFromLink: a Pinterest pin (pinterest.com, pin.it) or a direct
 * image address, fetched behind the SSRF guard (lib/integrations/web), the
 * pin's og:image taken, and the picture stored exactly like an upload
 * (storeAsset: type from the bytes, 5 MB, re-encoded, tenant-prefixed key).
 *
 * Every query runs under RLS (INV-1) and also names the workspace, so a scope
 * that can see more than one never mixes them.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import type { WorkspaceScope } from "./projects";
import { AssetError, storeAsset } from "./assets";
import { loadVisualIdentity, saveVisualIdentity } from "./foundation";
import { storage } from "@/lib/storage";
import { sniffType } from "@/lib/storage/sniff";
import { runTaskStamped } from "@/lib/ai";
import { lookRead, type LookReadResult } from "@/lib/ai/tasks";
import { loadBrandContext } from "@/lib/context/context-loader";
import { MAX_REFERENCES, cleanLook, type LookReading, type VisualCore } from "@/lib/visual/core";
import { contactSheet, forVision, imageFromPage, isPinterestUrl, measureColours } from "@/lib/visual/look-read";
import { ProviderError } from "@/lib/ai/errors";

import { WebImportError, safeGetImage, safeGetLink } from "@/lib/integrations/web";

/** The provider refused the request for its size (Groq: "Request too large ... tokens per minute"), not for what it asked. */
function tooLarge(e: unknown): boolean {
  return e instanceof ProviderError && /request too large|too large for model|reduce your message size|413/i.test(e.message);
}

interface RefRow {
  id: string;
  storage_key: string;
}

/** The reference designs on file, newest first, as the pages show them (at most three). */
async function referenceRows(scope: WorkspaceScope): Promise<RefRow[]> {
  return (
    await withTenantSession(scope, (c) =>
      c.query<RefRow>(
        `SELECT id, storage_key FROM assets
          WHERE tenant_id = $1 AND kind = 'reference_image' AND project_id IS NULL
          ORDER BY created_at DESC LIMIT $2`,
        [scope.tenantId, MAX_REFERENCES],
      ),
    )
  ).rows;
}

/** The task input: one line per design with its measured colours. Brand data is NOT here (INV-2). */
export function lookTaskInput(designs: { assetId: string; colours: string[] }[]): string {
  return [
    designs.length > 1
      ? `Designs: ${designs.length}, shown side by side in one picture, numbered in the top-left corner of each, left to right in this order`
      : "Designs: 1 (the picture)",
    ...designs.map((d, i) => `Design ${i + 1}: id ${d.assetId}; measured colours: ${d.colours.join(", ") || "none measured"}`),
  ].join("\n");
}

/**
 * Read every current reference design in one call and store the reading.
 * No designs: the reading is removed and null comes back. A model failure
 * throws (the caller shows it with Try again); the stored reading is left as
 * it was.
 */
export async function readLook(scope: WorkspaceScope): Promise<LookReading | null> {
  const started = new Date().toISOString();
  const rows = await referenceRows(scope);
  const files = await Promise.all(rows.map(async (r) => ({ row: r, file: await storage().get(r.storage_key).catch(() => null) })));
  const usable = files.filter((f): f is { row: RefRow; file: { data: Uint8Array; mime: string } } => !!f.file);
  if (!usable.length) {
    await writeLook(scope, null, started);
    return null;
  }
  const prepared = await Promise.all(
    usable.map(async ({ row, file }) => ({
      assetId: row.id.toLowerCase(),
      colours: await measureColours(file.data),
    })),
  );
  // One picture whatever the count: a single design as itself, several as one
  // numbered contact sheet (lib/visual/look-read contactSheet: an image costs
  // a fixed amount on Groq, so three images never fit the free tier).
  const image = usable.length === 1 ? await forVision(usable[0].file.data) : await contactSheet(usable.map((u) => u.file.data));
  // INV-2: the voice the look is matched to comes from the one context builder.
  // The reading being replaced stays out, so the pictures are read afresh.
  const context = await loadBrandContext(scope, undefined, undefined, undefined, { withoutLook: true });
  let out: Awaited<ReturnType<typeof runTaskStamped<LookReadResult>>>;
  try {
    out = await runTaskStamped(scope, lookRead, { context, taskInput: lookTaskInput(prepared), images: [image] });
  } catch (e) {
    // Too big for the plan's tokens a minute: said plainly, not "logged".
    if (tooLarge(e)) throw new AssetError("These designs are too much to read at once on the current plan. Remove one, or ask your admin to move to a paid plan.");
    throw e;
  }
  const said = out.data;
  // Each design keeps its own measured colours; the model's summary is
  // matched by id, or by position when it mangled the id.
  const designs = prepared.map((p, i) => {
    const byId = said.designs.find((d) => d.assetId.trim().toLowerCase() === p.assetId);
    return { assetId: p.assetId, summary: (byId ?? said.designs[i])?.summary ?? "", colours: p.colours };
  });
  const reading = cleanLook({
    at: started,
    sources: prepared.map((p) => p.assetId),
    model: out.model,
    designs,
    mood: said.mood,
    typeFeel: said.typeFeel,
    layout: said.layout,
    photoStyle: said.photoStyle,
    motifs: said.motifs,
    colourUse: said.colourUse,
    agrees: said.agrees,
    clashes: said.clashes,
    direction: said.direction,
    avoid: said.avoid,
  });
  return writeLook(scope, reading, started);
}

/**
 * Store a reading (or remove it, with null), in one transaction on the
 * workspace's visual row:
 *   - a reading started before the one already stored never replaces it
 *     (two designs added quickly start two readings; the later one wins);
 *   - a reading whose designs are no longer all on file is stored stale;
 *   - layout, motifs and photo style are seeded from it only where empty.
 * Returns what was stored.
 */
async function writeLook(scope: WorkspaceScope, reading: LookReading | null, started: string): Promise<LookReading | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const done = await withTenantSession(scope, async (c) => {
      const row = (
        await c.query<{ id: string; core: VisualCore }>(
          `SELECT vi.id, vi.core FROM visual_identities vi JOIN brand_profiles bp ON bp.id = vi.brand_profile_id
            WHERE vi.tenant_id = $1 AND bp.project_id IS NULL
            ORDER BY bp.status='active' DESC, bp.updated_at DESC LIMIT 1 FOR UPDATE OF vi`,
          [scope.tenantId],
        )
      ).rows[0];
      if (!row) return { missing: true as const };
      const core: VisualCore = row.core ?? {};
      const existing = cleanLook(core.look);
      if (existing && !existing.stale && existing.at > started) return { stored: existing };
      const current = (
        await c.query<{ id: string }>(
          `SELECT id FROM assets WHERE tenant_id = $1 AND kind = 'reference_image' AND project_id IS NULL ORDER BY created_at DESC LIMIT $2`,
          [scope.tenantId, MAX_REFERENCES],
        )
      ).rows.map((r) => r.id.toLowerCase());
      const next: VisualCore & Record<string, unknown> = { ...core, references: current };
      let stored: LookReading | null = null;
      if (!reading) {
        delete next.look;
      } else {
        const stale = reading.sources.some((s) => !current.includes(s));
        stored = { ...reading, ...(stale ? { stale: true } : {}) };
        next.look = stored;
        if (!stale) {
          // Only where the person has written nothing: their own words always win.
          if (!core.layout?.trim() && reading.layout) next.layout = reading.layout;
          if (!core.motifs?.trim() && reading.motifs) next.motifs = reading.motifs;
          if (!core.photoStyle?.trim() && reading.photoStyle) next.photoStyle = reading.photoStyle;
        }
      }
      await c.query(`UPDATE visual_identities SET core = $1 WHERE id = $2 AND tenant_id = $3`, [JSON.stringify(next), row.id, scope.tenantId]);
      return { stored };
    });
    if (!("missing" in done)) return done.stored;
    if (!reading) return null;
    // No visual row yet (a brand-new workspace): the one foundation writer makes it, then try again.
    await saveVisualIdentity(scope, await loadVisualIdentity(scope));
  }
  return reading;
}

// ---- a design from a link ------------------------------------------------------

/** The plain refusal when Pinterest won't hand over a pin's picture. */
export const PINTEREST_BLOCKED = "Pinterest didn't share that image. Save it and upload it instead.";

/**
 * Add a reference design from a link: a Pinterest pin (its og:image on
 * i.pinimg.com), any page that shares a picture, or a picture's own address.
 * Same checks and storage as an upload (storeAsset), and the same limit of
 * three designs. Throws AssetError with a message for the person.
 */
/** Refuses a fourth reference design, for uploads as well as links (the same message). */
export async function assertRoomForReference(scope: WorkspaceScope): Promise<void> {
  if ((await referenceRows(scope)).length >= MAX_REFERENCES) {
    throw new AssetError(`You have ${MAX_REFERENCES} designs. Remove one to add another.`);
  }
}

export async function addReferenceFromLink(
  scope: WorkspaceScope,
  raw: string,
  /** The guarded fetchers (lib/integrations/web); tests stand in for the network. */
  fetchers: { link: typeof safeGetLink; image: typeof safeGetImage } = { link: safeGetLink, image: safeGetImage },
): Promise<{ id: string }> {
  const url = raw.trim();
  if (!url) throw new AssetError("Paste a link first.");
  if ((await referenceRows(scope)).length >= MAX_REFERENCES) {
    throw new AssetError(`You have ${MAX_REFERENCES} designs. Remove one to add another.`);
  }
  const address = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const pin = isPinterestUrl(address);

  let bytes: Uint8Array;
  try {
    const first = await fetchers.link(address);
    if (/^image\//i.test(first.contentType)) {
      bytes = first.body;
    } else {
      const src = imageFromPage(new TextDecoder("utf-8", { fatal: false }).decode(first.body), first.url);
      if (!src) throw new AssetError(pin ? PINTEREST_BLOCKED : "That page doesn't share a picture. Save the image and upload it instead.");
      bytes = (await fetchers.image(src)).body;
    }
  } catch (e) {
    if (e instanceof AssetError) throw e;
    // A Pinterest refusal (a login wall, a 403, a picture it won't serve) gets the one plain answer.
    if (pin) throw new AssetError(PINTEREST_BLOCKED);
    if (e instanceof WebImportError) throw new AssetError(e.message);
    throw new AssetError("We couldn't fetch that link. Save the image and upload it instead.");
  }

  // The bytes decide, not the content type the site claimed.
  const type = sniffType(bytes);
  if (type !== "image/png" && type !== "image/jpeg" && type !== "image/webp") {
    throw new AssetError("That link isn't a PNG, JPG or WebP picture. Save the image and upload it instead.");
  }
  return storeAsset(scope, bytes, "reference_image");
}
