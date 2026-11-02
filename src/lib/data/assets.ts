/**
 * Asset uploads (brief §4.1, §07). The type is read from the file's own bytes
 * (lib/storage/sniff), never the name or what the browser claims, and stored
 * as detected; SVGs with any active content are refused. Size-limited, stored
 * under a tenant-prefixed key, served via short-lived signed URLs (INV-1) with
 * locked-down headers (api/storage).
 *
 * Not done: re-encoding images (it would also strip metadata). It needs an
 * image library (sharp); add it here before persisting if that is wanted.
 *
 * Server-only.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { withTenantSession } from "@/db/session";
import type { WorkspaceScope } from "./projects";
import { storage, tenantKey } from "@/lib/storage";
import { sniffType, svgProblem } from "@/lib/storage/sniff";

export type AssetKind = "logo" | "reference_image" | "headshot" | "font" | "other";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED: Record<AssetKind, string[]> = {
  logo: ["image/png", "image/jpeg", "image/svg+xml", "image/webp"],
  reference_image: ["image/png", "image/jpeg", "image/webp"],
  // A person's face (0014): kept apart from reference images so it can be found and removed on its own.
  headshot: ["image/png", "image/jpeg", "image/webp"],
  font: ["font/woff", "font/woff2", "font/ttf", "font/otf", "application/font-woff"],
  other: [],
};
const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg",
  "image/webp": "webp", "font/woff": "woff", "font/woff2": "woff2",
  "font/ttf": "ttf", "font/otf": "otf",
};

/** A refused upload, worded for the person who chose the file. */
export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetError";
  }
}

const describe = (types: string[]) => {
  const names = [...new Set(types.map((t) => ({ "image/svg+xml": "SVG", "application/font-woff": "WOFF" })[t] ?? t.split("/")[1].toUpperCase()))];
  return names.length ? `a ${names.slice(0, -1).join(", ")}${names.length > 1 ? " or " : ""}${names.at(-1)} file` : "a different file";
};

export async function uploadAsset(
  scope: WorkspaceScope,
  file: File,
  kind: AssetKind,
): Promise<void> {
  await storeAsset(scope, new Uint8Array(await file.arrayBuffer()), kind);
}

/**
 * The checks and the save, for bytes from a form or from storage (a direct
 * upload, lib/storage/upload). Both routes go through here.
 */
export async function storeAsset(
  scope: WorkspaceScope,
  bytes: Uint8Array,
  kind: AssetKind,
): Promise<void> {
  if (!scope.tenantId) throw new Error("no tenant scope");
  if (bytes.byteLength === 0) throw new Error("empty file");
  if (bytes.byteLength > MAX_BYTES) throw new AssetError("That file is over 5 MB. Export a smaller one.");
  const mime = sniffType(bytes);
  const allowed = ALLOWED[kind];
  if (!mime || (allowed.length && !allowed.includes(mime))) {
    throw new AssetError(`That file isn't one we can use here. Upload ${describe(allowed)}.`);
  }
  if (mime === "image/svg+xml") {
    const why = svgProblem(bytes);
    if (why) throw new AssetError(`That SVG can't be used: ${why}. Export it again as a plain SVG, or upload a PNG.`);
  }

  const ext = EXT[mime] ?? "bin";
  const key = tenantKey(scope.tenantId, "assets", `${randomUUID()}.${ext}`);
  await storage().put(key, bytes, mime);

  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO assets (tenant_id, project_id, kind, storage_key, mime, bytes, created_by)
       VALUES ($1,$7,$2,$3,$4,$5,$6)`,
      // Brand uploads (logos, fonts, references) belong to the workspace, not a
      // piece (migration 0007), so project_id is NULL like the rest of the brand.
      [scope.tenantId, kind, key, mime, bytes.byteLength, scope.userId, null],
    ),
  );
}

export interface AssetView {
  id: string;
  kind: string;
  mime: string;
  url: string;
}

export async function listAssets(scope: WorkspaceScope): Promise<AssetView[]> {
  const rows = (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string; kind: string; mime: string; storage_key: string }>(
        `SELECT id, kind, mime, storage_key FROM assets WHERE project_id IS NULL ORDER BY created_at DESC LIMIT 24`,
        [],
      ),
    )
  ).rows;
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      kind: r.kind,
      mime: r.mime,
      url: await storage().signedUrl(r.storage_key),
    })),
  );
}
