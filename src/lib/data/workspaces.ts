/**
 * Workspace listing + summary for the home grid and the workspace switcher.
 *
 * Which workspaces a user may SEE is decided by role (brief §02):
 *   owner_admin → all · coach → home org + assigned · client → own only.
 * The list of ids comes from management tables (admin policy, trusted internal
 * read); each workspace's CONTENT summary is then read inside that workspace's
 * own tenant scope, so client content never crosses an admin bypass (INV-1).
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession, type SessionScope } from "@/db/session";
import { isPlatformAdmin, type Session } from "@/lib/auth/types";

export interface WorkspaceSummary {
  id: string;
  name: string;
  status: string;
  completeness: number;
  niche: string | null;
  palette: string[];
  contentCount: number;
  isHome: boolean;
}

const ADMIN_READ = (userId: string): SessionScope => ({
  tenantId: null,
  userId,
  isPlatformAdmin: true,
});

async function accessibleTenants(session: Session): Promise<{ id: string; name: string; status: string }[]> {
  if (isPlatformAdmin(session.role)) {
    return (
      await withTenantSession(ADMIN_READ(session.userId), (c) =>
        c.query("SELECT id, name, status FROM tenants ORDER BY created_at ASC"),
      )
    ).rows;
  }
  if (session.role === "coach") {
    // Trusted internal read of the coach's assignments (same as resolveScope).
    return (
      await withTenantSession(ADMIN_READ(session.userId), (c) =>
        c.query(
          `SELECT t.id, t.name, t.status FROM tenants t
            WHERE t.id = $1
               OR t.id IN (SELECT tenant_id FROM coach_assignments WHERE coach_user_id = $2)
            ORDER BY t.created_at ASC`,
          [session.tenantId, session.userId],
        ),
      )
    ).rows;
  }
  return (
    await withTenantSession(
      { tenantId: session.tenantId, userId: session.userId, isPlatformAdmin: false },
      (c) => c.query("SELECT id, name, status FROM tenants WHERE id = $1", [session.tenantId]),
    )
  ).rows;
}

async function contentSummary(tenantId: string, userId: string) {
  return withTenantSession({ tenantId, userId, isPlatformAdmin: false }, async (c) => {
    const bp = (
      await c.query(
        `SELECT id, completeness, niche FROM brand_profiles
          ORDER BY status='active' DESC, updated_at DESC LIMIT 1`,
      )
    ).rows[0];
    const vi = bp
      ? (await c.query("SELECT palette FROM visual_identities WHERE brand_profile_id=$1 LIMIT 1", [bp.id])).rows[0]
      : null;
    const n = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM content_items")).rows[0].n;
    return {
      completeness: bp?.completeness ?? 0,
      niche: bp?.niche ?? null,
      palette: (vi?.palette ?? []) as string[],
      contentCount: n,
    };
  });
}

export async function listWorkspaceSummaries(session: Session): Promise<WorkspaceSummary[]> {
  const tenants = await accessibleTenants(session);
  return Promise.all(
    tenants.map(async (t) => ({
      ...t,
      ...(await contentSummary(t.id, session.userId)),
      isHome: t.id === session.tenantId,
    })),
  );
}

/** Lightweight list for the switcher (no content reads). */
export async function listWorkspaceNames(session: Session) {
  return accessibleTenants(session);
}

export async function getWorkspace(scope: SessionScope) {
  return (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string; name: string; status: string; branding: Record<string, unknown> }>(
        "SELECT id, name, status, branding FROM tenants WHERE id = $1",
        [scope.tenantId],
      ),
    )
  ).rows[0];
}
