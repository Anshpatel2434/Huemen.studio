/**
 * Undo of a copy edit made on the Visual board.
 *
 * An edit on a visual writes the piece's copy (lib/data/content patchContent),
 * which marks the piece "edited". Undoing it puts the words back, and the
 * piece is then exactly what it was, so its status goes back too: a draft
 * that was edited and undone is a draft again, and an approved piece is
 * approved again. Without this the undo left "edited" on a piece nobody had
 * changed (2026-11-17).
 *
 * The status is only restored when the words really are back (the write went
 * through with the same stale-canvas check as any edit) and the piece still
 * says "edited": a status set since then by someone else is left alone.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import { patchContent } from "./content";
import type { ProjectScope } from "./projects";

export const CONTENT_STATUSES = ["draft", "edited", "approved"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

type Copy = { hook?: string; body?: string; cta?: string };

/**
 * "Approve again" from the notice an edit on a visual shows when it moved an
 * approved piece back to edited (2026-11-18 new-account run: the heading edit
 * un-approved the post with no word). Only a piece that still says "edited"
 * is approved; returns whether it was.
 */
export async function approveAgain(scope: ProjectScope, itemId: string): Promise<{ hook: string } | null> {
  return withTenantSession(scope, async (c) =>
    (await c.query<{ hook: string }>(
      "UPDATE content_items SET status='approved' WHERE id=$1 AND project_id=$2 AND status='edited' RETURNING hook",
      [itemId, scope.projectId],
    )).rows[0] ?? null,
  );
}

export async function revertCopy(scope: ProjectScope, itemId: string, patch: Copy, base: Copy | null, status: string | null): Promise<void> {
  await patchContent(scope, itemId, patch, base);
  if (!status || status === "edited" || !(CONTENT_STATUSES as readonly string[]).includes(status)) return;
  await withTenantSession(scope, (c) =>
    c.query("UPDATE content_items SET status=$1 WHERE id=$2 AND project_id=$3 AND status='edited'", [status, itemId, scope.projectId]),
  );
}
