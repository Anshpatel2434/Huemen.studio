/**
 * The voice keeps learning from use (spec file 01 §4, "edits are training"),
 * per person and inside their workspace only.
 *
 *   learnFromApproval  an approved piece the owner wrote or rewrote joins their
 *                      writing (source 'studio'); every RELEARN_EVERY such
 *                      pieces the voice re-measures itself and saves a version
 *                      that says why, so it can be seen and restored.
 *   learningLog        what the voice has learned from, newest first, for the
 *                      Voice page.
 *
 * What is never automatic: rules. A word the person keeps deleting becomes a
 * proposal (lib/data/training recordEdit); a re-measure changes only measured
 * numbers, never what the person wrote down about themselves.
 *
 * Every query runs in the workspace's own RLS session, and samples are written
 * through addSamples, which refuses a pack this session can't see; so one
 * person's approvals can never reach another person's voice.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import type { ProjectScope, WorkspaceScope } from "./projects";
import { addSamples, loadPackForWorkspace, rescan } from "./voice-pack";
import { ownsVoice, type Actor } from "./training";
import { learnDecision, relearnDue, type LearnDecision } from "@/lib/voice/learn";

const text = (r: { hook: string | null; body: string | null; cta: string | null }) =>
  [r.hook, r.body, r.cta].filter((x) => x && x.trim()).join("\n\n");

export type LearnOutcome = LearnDecision & { remeasured: boolean };

export async function learnFromApproval(scope: ProjectScope, actor: Actor, itemId: string): Promise<LearnOutcome | null> {
  const pack = await loadPackForWorkspace(scope);
  if (!pack) return null;

  const piece = await withTenantSession(scope, async (c) => {
    const item = (
      await c.query<{ hook: string | null; body: string | null; cta: string | null; channel: string; status: string }>(
        `SELECT hook, body, cta, channel, status FROM content_items WHERE id = $1 AND project_id = $2`,
        [itemId, scope.projectId],
      )
    ).rows[0];
    if (!item) return null;
    const generated = (
      await c.query<{ hook: string | null; body: string | null; cta: string | null }>(
        `SELECT hook, body, cta FROM content_generations WHERE content_item_id = $1`,
        [itemId],
      )
    ).rows.map(text);
    return { item, generated };
  });
  if (!piece || piece.item.status !== "approved") return null;

  const final = text(piece.item);
  const decision = learnDecision({ final, generated: piece.generated, owner: ownsVoice(actor, pack) });
  if (!decision.learn) return { ...decision, remeasured: false };

  await addSamples(scope, pack.id, [{
    body: final,
    channel: piece.item.channel,
    kind: "corpus",
    source: "studio",
    visibility: "public",
    note: `approved:${itemId}`,
  }]);

  // Re-measure once enough new writing has landed since the last measure.
  const since = await learnedSinceScan(scope, pack.id, pack.scannedAt);
  let remeasured = false;
  if (relearnDue(since)) {
    await rescan(scope, pack.id, `Learned from ${since} pieces you approved in the studio.`);
    remeasured = true;
  }
  return { ...decision, remeasured };
}

async function learnedSinceScan(scope: WorkspaceScope, packId: string, scannedAt: string | null): Promise<number> {
  return withTenantSession(scope, async (c) =>
    (
      await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM voice_samples
          WHERE pack_id = $1 AND source = 'studio' AND excluded = false
            AND ($2::timestamptz IS NULL OR created_at > $2::timestamptz)`,
        [packId, scannedAt],
      )
    ).rows[0].n,
  );
}

export interface LearnedPiece {
  id: string;
  excerpt: string;
  words: number;
  at: string;
}

/** What the voice has learned from in the studio, newest first. */
export async function learningLog(scope: WorkspaceScope, packId: string, limit = 8): Promise<{ pieces: LearnedPiece[]; total: number }> {
  return withTenantSession(scope, async (c) => {
    const rows = (
      await c.query<{ id: string; body: string; word_count: number; created_at: Date }>(
        `SELECT id, body, word_count, created_at FROM voice_samples
          WHERE pack_id = $1 AND source = 'studio' AND excluded = false
          ORDER BY created_at DESC LIMIT $2`,
        [packId, limit],
      )
    ).rows;
    const total = (
      await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM voice_samples WHERE pack_id = $1 AND source = 'studio' AND excluded = false`,
        [packId],
      )
    ).rows[0].n;
    return {
      total,
      pieces: rows.map((r) => ({
        id: r.id,
        excerpt: r.body.split("\n")[0].slice(0, 120),
        words: r.word_count,
        at: r.created_at.toISOString(),
      })),
    };
  });
}
