/**
 * Asset uploads (brief §4.1, §07). Type + size validated; stored under a
 * tenant-prefixed key; served via short-lived signed URLs (INV-1).
 *
 * NOTE: image re-encoding (§07) is deferred to the security pass (P4-1) — add a
 * sharp re-encode step in `uploadAsset` before persisting.
 *
 * Server-only.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { withTenantSession } from "@/db/session";
import type { ProjectScope } from "./projects";
import { storage, tenantKey } from "@/lib/storage";

export type AssetKind = "logo" | "reference_image" | "font" | "other";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED: Record<AssetKind, string[]> = {
  logo: ["image/png", "image/jpeg", "image/svg+xml", "image/webp"],
  reference_image: ["image/png", "image/jpeg", "image/webp"],
  font: ["font/woff", "font/woff2", "font/ttf", "font/otf", "application/font-woff"],
  other: [],
};
const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg",
  "image/webp": "webp", "font/woff": "woff", "font/woff2": "woff2",
  "font/ttf": "ttf", "font/otf": "otf",
};

export async function uploadAsset(
  scope: ProjectScope,
  file: File,
  kind: AssetKind,
): Promise<void> {
  if (!scope.tenantId) throw new Error("no tenant scope");
  if (file.size === 0) throw new Error("empty file");
  if (file.size > MAX_BYTES) throw new Error("file too large (max 5MB)");
  const allowed = ALLOWED[kind];
  if (allowed.length && !allowed.includes(file.type)) {
    throw new Error(`unsupported type ${file.type} for ${kind}`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = EXT[file.type] ?? "bin";
  const key = tenantKey(scope.tenantId, "assets", `${randomUUID()}.${ext}`);
  await storage().put(key, bytes, file.type);

  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO assets (tenant_id, project_id, kind, storage_key, mime, bytes, created_by)
       VALUES ($1,$7,$2,$3,$4,$5,$6)`,
      [scope.tenantId, kind, key, file.type, file.size, scope.userId, scope.projectId],
    ),
  );
}

export interface AssetView {
  id: string;
  kind: string;
  mime: string;
  url: string;
}

export async function listAssets(scope: ProjectScope): Promise<AssetView[]> {
  const rows = (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string; kind: string; mime: string; storage_key: string }>(
        `SELECT id, kind, mime, storage_key FROM assets WHERE project_id=$1 ORDER BY created_at DESC LIMIT 24`,
        [scope.projectId],
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
