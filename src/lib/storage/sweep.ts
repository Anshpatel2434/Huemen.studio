/**
 * Removes uploads that were sent to storage and never used.
 *
 * A direct upload (./upload) lands under tenants/<id>/incoming/ and the step
 * that uses it takes it out again (takeIncoming) within minutes: the write
 * link lasts ten minutes. A file still there a day later was abandoned (the
 * tab closed, the step failed, someone called the upload endpoint and never
 * finished), and nothing else will ever read or remove it.
 *
 * The sweep lists the workspaces' folders in storage itself rather than the
 * database, so it also finds files of a workspace that has since been deleted,
 * and it needs no table, no tenant session and no bookkeeping on each upload.
 * It only ever looks under tenants/<uuid>/incoming/ and only removes files
 * older than ABANDONED_AFTER_MS, so a file being uploaded or taken right now
 * is never touched.
 *
 * Called by the scheduled job (app/api/cron). Safe to run as often as wanted,
 * and from two places at once: removing a file that is already gone is fine.
 *
 * Server-only.
 */
import "server-only";
import { logger } from "@/lib/observability/log";
import { storage } from "./index";
import type { StorageDriver } from "./types";

/** How old an incoming file must be before it counts as abandoned. */
export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000;

const WORKSPACE_FOLDER = /^tenants\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/i;

/**
 * Delete every file under a workspace's incoming/ prefix that was written
 * more than a day before `now`. Returns how many were removed. A failure on
 * one workspace is logged and the rest are still swept.
 */
export async function sweepAbandonedUploads(now: Date = new Date()): Promise<{ removed: number }> {
  return sweepIncoming(storage(), now);
}

/** The sweep against a given driver. Exported for tests. */
export async function sweepIncoming(driver: StorageDriver, now: Date = new Date()): Promise<{ removed: number }> {
  const cutoff = now.getTime() - ABANDONED_AFTER_MS;
  const { prefixes } = await driver.list("tenants/", { delimiter: "/" });
  let removed = 0;
  let failed = 0;
  for (const folder of prefixes) {
    if (!WORKSPACE_FOLDER.test(folder)) continue;
    const tenantId = folder.split("/")[1];
    try {
      const { objects } = await driver.list(`${folder}incoming/`);
      for (const o of objects) {
        if (o.modified.getTime() >= cutoff || !o.key.startsWith(`${folder}incoming/`)) continue;
        await driver.delete(o.key);
        removed++;
      }
    } catch (err) {
      failed++;
      logger.warn("abandoned uploads not swept for a workspace", { tenantId, err });
    }
  }
  logger.info("abandoned uploads swept", { removed, workspaces: prefixes.length, failed, driver: driver.name });
  return { removed };
}
