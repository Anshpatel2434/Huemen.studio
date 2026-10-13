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

export interface CapsRow {
  tenantId: string;
  textSoft: number | null;
  textHard: number | null;
  imageSoft: number | null;
  imageHard: number | null;
}

/** Every workspace's caps, for the admin page. A workspace with no row is uncapped. */
export async function listCaps(session: Session): Promise<Map<string, CapsRow>> {
  const scope = scopeOf(session);
  const rows = (
    await withTenantSession(scope, (c) =>
      c.query<{ tenant_id: string; monthly_text_soft: number | null; monthly_text_hard: number | null; monthly_image_soft: number | null; monthly_image_hard: number | null }>(
        "SELECT * FROM tenant_usage_caps",
      ),
    )
  ).rows;
  return new Map(
    rows.map((r) => [
      r.tenant_id,
      { tenantId: r.tenant_id, textSoft: r.monthly_text_soft, textHard: r.monthly_text_hard, imageSoft: r.monthly_image_soft, imageHard: r.monthly_image_hard },
    ]),
  );
}

/**
 * Set a workspace's monthly caps (brief §4.6, TASKS P3-9). Null clears a cap.
 * Audited, because a cap change is a cost decision (§07).
 */
export async function setUsageCaps(session: Session, tenantId: string, caps: Omit<CapsRow, "tenantId">): Promise<void> {
  const scope = scopeOf(session);
  const clean = (n: number | null) => (n !== null && Number.isFinite(n) && n > 0 ? Math.round(n) : null);
  const next = { textSoft: clean(caps.textSoft), textHard: clean(caps.textHard), imageSoft: clean(caps.imageSoft), imageHard: clean(caps.imageHard) };
  await withTenantSession(scope, (c) =>
    c.query(
      `INSERT INTO tenant_usage_caps (tenant_id, monthly_text_soft, monthly_text_hard, monthly_image_soft, monthly_image_hard, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id) DO UPDATE SET
         monthly_text_soft = EXCLUDED.monthly_text_soft, monthly_text_hard = EXCLUDED.monthly_text_hard,
         monthly_image_soft = EXCLUDED.monthly_image_soft, monthly_image_hard = EXCLUDED.monthly_image_hard,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, next.textSoft, next.textHard, next.imageSoft, next.imageHard, scope.userId],
    ),
  );
  await audit(scope, tenantId, "caps.update", next);
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
