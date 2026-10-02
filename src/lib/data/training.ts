/**
 * The core after day one (Flow 4: Train). Every change to a voice is either
 * made by its owner or proposed to them; nothing changes silently.
 *
 *   writePack        the role-aware write. The owner's change saves. A coach's
 *                    change to someone else's voice becomes a proposal the
 *                    owner approves (plan: "coach proposes, owner approves").
 *   recordEdit       what a person keeps deleting from drafts. Four of the same
 *                    removal becomes a proposal card, never a silent rule.
 *   restoreVersion   go back to any saved version. Restoring is itself a save,
 *                    so it can be undone the same way.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import type { Role } from "@/lib/auth/types";
import type { WorkspaceScope } from "./projects";
import { listVersions, savePack, type PackPatch } from "./voice-pack";
import { EDIT_THRESHOLD, removedWords } from "@/lib/voice/derive";
import { tagged, type VoicePack } from "@/lib/voice/types";

export interface Actor {
  userId: string;
  role: Role;
}

/** Whether this person may change this voice directly, or only propose. */
export const ownsVoice = (actor: Actor, pack: VoicePack): boolean =>
  actor.userId === pack.userId || actor.role === "client";

export type WriteOutcome = { saved: true; pack: VoicePack | null } | { proposed: true };

export async function writePack(
  scope: WorkspaceScope,
  actor: Actor,
  pack: VoicePack,
  patch: PackPatch,
  note: string,
): Promise<WriteOutcome> {
  if (ownsVoice(actor, pack)) {
    return { saved: true, pack: await savePack(scope, pack.id, patch, note) };
  }
  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO voice_pack_proposals (tenant_id, pack_id, patch, note, proposed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [scope.tenantId, pack.id, JSON.stringify(patch), note, actor.userId],
    ),
  );
  return { proposed: true };
}

export interface Proposal {
  id: string;
  note: string | null;
  proposedBy: string | null;
  createdAt: string;
  fields: string[];
}

export async function listProposals(scope: WorkspaceScope, packId: string): Promise<Proposal[]> {
  return withTenantSession(scope, async (c) =>
    (
      await c.query<{ id: string; note: string | null; email: string | null; created_at: Date; patch: Record<string, unknown> }>(
        `SELECT p.id, p.note, u.email, p.created_at, p.patch
           FROM voice_pack_proposals p LEFT JOIN users u ON u.id = p.proposed_by
          WHERE p.pack_id = $1 AND p.status = 'pending' ORDER BY p.created_at`,
        [packId],
      )
    ).rows.map((r) => ({
      id: r.id,
      note: r.note,
      proposedBy: r.email,
      createdAt: r.created_at.toISOString(),
      fields: Object.keys(r.patch ?? {}),
    })),
  );
}

/** Only the voice's owner decides on a proposal to it. */
export async function decideProposal(
  scope: WorkspaceScope,
  actor: Actor,
  pack: VoicePack,
  proposalId: string,
  approve: boolean,
): Promise<boolean> {
  if (actor.userId !== pack.userId && actor.role !== "client") return false;
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<{ patch: PackPatch; note: string | null }>(
        `UPDATE voice_pack_proposals SET status = $1, decided_by = $2, decided_at = now()
          WHERE id = $3 AND pack_id = $4 AND status = 'pending' RETURNING patch, note`,
        [approve ? "approved" : "rejected", actor.userId, proposalId, pack.id],
      ),
    )
  ).rows[0];
  if (!row) return false;
  if (approve) await savePack(scope, pack.id, row.patch, `Approved: ${row.note ?? "a coach's change"}`);
  return true;
}

// ---- edits are training -----------------------------------------------------

/**
 * Count what an edit removed. A word the person has already banned is not
 * counted again; one they dismissed stays dismissed.
 */
export async function recordEdit(scope: WorkspaceScope, pack: VoicePack, before: string, after: string): Promise<void> {
  const banned = new Set(pack.index.neverWords.map((w) => w.toLowerCase()));
  const removed = removedWords(before, after).filter((w) => !banned.has(w));
  if (!removed.length) return;
  await withTenantSession(scope, async (c) => {
    for (const value of removed) {
      await c.query(
        `INSERT INTO voice_edit_signals (tenant_id, pack_id, kind, value, count)
         VALUES ($1,$2,'removed_word',$3,1)
         ON CONFLICT (pack_id, kind, value) DO UPDATE
           SET count = voice_edit_signals.count + 1,
               updated_at = now(),
               status = CASE
                 WHEN voice_edit_signals.status = 'counting' AND voice_edit_signals.count + 1 >= $4 THEN 'proposed'
                 ELSE voice_edit_signals.status END`,
        [scope.tenantId, pack.id, value, EDIT_THRESHOLD],
      );
    }
  });
}

export interface EditProposal {
  id: string;
  value: string;
  count: number;
}

export async function listEditProposals(scope: WorkspaceScope, packId: string): Promise<EditProposal[]> {
  return withTenantSession(scope, async (c) =>
    (
      await c.query<{ id: string; value: string; count: number }>(
        `SELECT id, value, count FROM voice_edit_signals
          WHERE pack_id = $1 AND status = 'proposed' ORDER BY count DESC, value`,
        [packId],
      )
    ).rows,
  );
}

export async function decideEditProposal(
  scope: WorkspaceScope,
  actor: Actor,
  pack: VoicePack,
  signalId: string,
  accept: boolean,
): Promise<void> {
  const row = (
    await withTenantSession(scope, (c) =>
      c.query<{ value: string }>(
        `UPDATE voice_edit_signals SET status = $1, updated_at = now()
          WHERE id = $2 AND pack_id = $3 AND status = 'proposed' RETURNING value`,
        [accept ? "accepted" : "dismissed", signalId, pack.id],
      ),
    )
  ).rows[0];
  if (!row || !accept) return;
  const never = [...new Set([...pack.index.neverWords, row.value])];
  await writePack(
    scope,
    actor,
    pack,
    { index: { ...pack.index, neverWords: never }, redPen: { ...pack.redPen, neverList: tagged(never, "edit") } },
    `Added "${row.value}" to the never-list: you removed it from drafts repeatedly.`,
  );
}

// ---- versions -----------------------------------------------------------------

/** Fields a restore puts back. Measurements, corpus and history are not rewound. */
const RESTORABLE = ["voiceLine", "hardRules", "identity", "guardrails", "redPen", "index", "workMode"] as const;

export async function restoreVersion(
  scope: WorkspaceScope,
  actor: Actor,
  pack: VoicePack,
  version: number,
): Promise<WriteOutcome | null> {
  const v = (await listVersions(scope, pack.id, 200)).find((x) => x.version === version);
  if (!v) return null;
  const snap = v.snapshot as unknown as Record<string, unknown>;
  const patch = Object.fromEntries(
    RESTORABLE.filter((k) => snap[k] !== undefined).map((k) => [k, snap[k]]),
  ) as PackPatch;
  return writePack(scope, actor, pack, patch, `Restored version ${version}.`);
}

/** Approved pieces in the workspace: the clock for the Deep question drip. */
export async function approvedPieceCount(scope: WorkspaceScope): Promise<number> {
  return withTenantSession(scope, async (c) =>
    (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM content_items WHERE status = 'approved'`)).rows[0].n,
  );
}

/** Pieces approved since a moment: "new writing" for the 90-day re-measure invite. */
export async function approvedSince(scope: WorkspaceScope, since: string | null): Promise<number> {
  if (!since) return 0;
  return withTenantSession(scope, async (c) =>
    (
      await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM content_items WHERE status = 'approved' AND updated_at > $1`,
        [since],
      )
    ).rows[0].n,
  );
}
