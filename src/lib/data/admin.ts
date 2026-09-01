/**
 * Admin / workspace provisioning (brief §4.6). Owner-Admin only. Lets Sahil's
 * team create, invite, assign and archive WITHOUT a developer touching the DB
 * (handover truth #3). Every mutation writes an admin_audit_log row (§07).
 *
 * All queries run under an admin-global scope (isPlatformAdmin), which the
 * admin_all RLS policies permit on management tables only.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession, type SessionScope } from "@/db/session";
import { adminGlobalScope } from "@/lib/auth/scope";
import type { Session, Role } from "@/lib/auth/types";

export interface WorkspaceRow {
  id: string;
  name: string;
  status: string;
  user_count: number;
  created_at: string;
}

function scopeOf(session: Session): SessionScope {
  return adminGlobalScope(session); // throws if not Owner/Admin
}

async function audit(
  scope: SessionScope,
  tenantId: string,
  action: string,
  target: Record<string, unknown>,
) {
  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO admin_audit_log (tenant_id, actor_user_id, action, target)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, scope.userId, action, JSON.stringify(target)],
    ),
  );
}

export async function listWorkspaces(session: Session): Promise<WorkspaceRow[]> {
  const scope = scopeOf(session);
  return (
    await withTenantSession(scope, (c) =>
      c.query<WorkspaceRow>(
        `SELECT t.id, t.name, t.status,
                (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id) AS user_count,
                t.created_at
           FROM tenants t ORDER BY t.created_at DESC`,
      ),
    )
  ).rows;
}

export async function listCoaches(session: Session) {
  const scope = scopeOf(session);
  return (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE role IN ('owner_admin','coach') ORDER BY email`,
      ),
    )
  ).rows;
}

export async function createWorkspace(session: Session, name: string): Promise<string> {
  const scope = scopeOf(session);
  const id = (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name]),
    )
  ).rows[0].id;
  await audit(scope, id, "workspace.create", { name });
  return id;
}

export async function inviteUser(
  session: Session,
  tenantId: string,
  email: string,
  role: Role,
): Promise<void> {
  const scope = scopeOf(session);
  // Invite = create the user record in 'invited' state. Email delivery is wired
  // with the managed auth provider (v1 is email-invite only).
  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO users (tenant_id, email, role, status, invited_by)
       VALUES ($1,$2,$3,'invited',$4)
       ON CONFLICT (tenant_id, email) DO NOTHING`,
      [tenantId, email, role, scope.userId],
    ),
  );
  await audit(scope, tenantId, "user.invite", { email, role });
}

export async function assignCoach(
  session: Session,
  tenantId: string,
  coachUserId: string,
): Promise<void> {
  const scope = scopeOf(session);
  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO coach_assignments (tenant_id, coach_user_id, assigned_by)
       VALUES ($1,$2,$3) ON CONFLICT (tenant_id, coach_user_id) DO NOTHING`,
      [tenantId, coachUserId, scope.userId],
    ),
  );
  await audit(scope, tenantId, "coach.assign", { coachUserId });
}

export async function setWorkspaceStatus(
  session: Session,
  tenantId: string,
  status: "active" | "archived",
): Promise<void> {
  const scope = scopeOf(session);
  await withTenantSession(scope, (c) =>
    c.query("UPDATE tenants SET status=$1 WHERE id=$2", [status, tenantId]),
  );
  await audit(scope, tenantId, "workspace.status", { status });
}
