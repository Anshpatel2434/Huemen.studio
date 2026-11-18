/**
 * The workspace's uploaded font files, for the visual page (lib/visual/fonts).
 * Server-only.
 *
 * Read under the tenant's session (RLS), and each key checked again against
 * the tenant (defence in depth, INV-1). Each file goes out as a short-lived
 * signed link through /api/storage, like the logo: long enough for a working
 * session, because the PNG export fetches it again. The family name inside a
 * file is read once per stored key (keys are never reused) and remembered.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import type { WorkspaceScope } from "@/lib/data/projects";
import { appSignedUrl, keyBelongsToTenant, storage } from "@/lib/storage";
import { readFontInfo, type FontInfo } from "./font-name";
import type { UploadedFont } from "./fonts";

/** How many font files are considered (newest first): a heading and body family, a few weights each. */
const MAX_FILES = 8;
const LINK_SECONDS = 8 * 60 * 60;

const infoCache = new Map<string, FontInfo>();
async function infoOf(key: string): Promise<FontInfo> {
  const hit = infoCache.get(key);
  if (hit) return hit;
  const obj = await storage().get(key).catch(() => null);
  const info = obj ? readFontInfo(obj.data) : { family: null, weight: null, italic: false };
  if (infoCache.size > 500) infoCache.clear();
  if (obj) infoCache.set(key, info);
  return info;
}

export async function brandFontUploads(scope: WorkspaceScope): Promise<UploadedFont[]> {
  const rows = (
    await withTenantSession(scope, (c) =>
      c.query<{ storage_key: string; mime: string }>(
        `SELECT storage_key, mime FROM assets WHERE kind = 'font' AND project_id IS NULL ORDER BY created_at DESC LIMIT ${MAX_FILES}`,
      ),
    )
  ).rows.filter((r) => keyBelongsToTenant(r.storage_key, scope.tenantId));
  return Promise.all(
    rows.map(async (r) => ({ ...(await infoOf(r.storage_key)), url: appSignedUrl(r.storage_key, LINK_SECONDS), mime: r.mime })),
  );
}
