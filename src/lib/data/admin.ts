/**
 * Admin / workspace provisioning (brief §4.6). Owner-Admin only. Lets Sahil's
 * team create, invite, assign, disable and archive WITHOUT a developer
 * touching the DB (handover truth #3). Every mutation writes an
 * admin_audit_log row in the SAME transaction as the change (§07): a change
 * that can't be audited doesn't happen.
 *
 * Who belongs where: admins and coaches are people of the owner's own
 * organisation (the admin's home workspace) and coaches are assigned to client
 * workspaces; a client workspace only has clients. An admin sees every
 * workspace, so admins are never invited into a client's workspace.
 *
 * All queries run under an admin-global scope (isPlatformAdmin), which the
 * admin_all RLS policies permit on management tables only.
 *
 * Server-only.
 */
import "server-only";
import type { PoolClient } from "pg";
import { withTenantSession, type SessionScope } from "@/db/session";
import { adminGlobalScope } from "@/lib/auth/scope";
import type { Session, Role } from "@/lib/auth/types";

export interface WorkspaceRow {
  id: string;
  name: string;
  status: string;
  user_count: number;
  created_at: string;
  accent: string | null;
}

/** A refused admin change, worded for the admin. */
export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminError";
  }
}

function scopeOf(session: Session): SessionScope {
  return adminGlobalScope(session); // throws if not Owner/Admin
}

async function audit(
  c: PoolClient,
  scope: SessionScope,
  tenantId: string,
  action: string,
  target: Record<string, unknown>,
) {
  await c.query(
    `INSERT INTO admin_audit_log (tenant_id, actor_user_id, action, target)
     VALUES ($1,$2,$3,$4)`,
    [tenantId, scope.userId, action, JSON.stringify(target)],
  );
}

/** Run one admin change and its audit row together. */
function change<T>(session: Session, fn: (c: PoolClient, scope: SessionScope) => Promise<T>): Promise<T> {
  const scope = scopeOf(session);
  return withTenantSession(scope, (c) => fn(c, scope));
}

export async function listWorkspaces(session: Session): Promise<WorkspaceRow[]> {
  const scope = scopeOf(session);
  return (
    await withTenantSession(scope, (c) =>
      c.query<WorkspaceRow>(
        `SELECT t.id, t.name, t.status,
                (SELECT count(*)::int FROM users u WHERE u.tenant_id = t.id AND u.status <> 'disabled') AS user_count,
                t.created_at, t.branding->>'accent' AS accent
           FROM tenants t ORDER BY (t.id = $1) DESC, t.created_at DESC`,
        [session.tenantId],
      ),
    )
  ).rows;
}

/** Coaches who can be assigned: active coaches of the owner's organisation. */
export async function listCoaches(session: Session) {
  const scope = scopeOf(session);
  return (
    await withTenantSession(scope, (c) =>
      c.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE role = 'coach' AND status = 'active' AND tenant_id = $1 ORDER BY email`,
        [session.tenantId],
      ),
    )
  ).rows;
}

/** Which coaches are assigned to which workspace. */
export async function listAssignments(session: Session): Promise<{ tenantId: string; coachUserId: string; email: string }[]> {
  const scope = scopeOf(session);
  return (
    await withTenantSession(scope, (c) =>
      c.query<{ tenant_id: string; coach_user_id: string; email: string }>(
        `SELECT a.tenant_id, a.coach_user_id, u.email
           FROM coach_assignments a JOIN users u ON u.id = a.coach_user_id
          ORDER BY u.email`,
      ),
    )
  ).rows.map((r) => ({ tenantId: r.tenant_id, coachUserId: r.coach_user_id, email: r.email }));
}

export async function createWorkspace(session: Session, name: string): Promise<string> {
  return change(session, async (c, scope) => {
    const id = (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id;
    await audit(c, scope, id, "workspace.create", { name });
    return id;
  });
}

export async function renameWorkspace(session: Session, tenantId: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new AdminError("A workspace needs a name.");
  await change(session, async (c, scope) => {
    const before = (await c.query<{ name: string }>("UPDATE tenants t SET name = $1 FROM tenants old WHERE t.id = $2 AND old.id = t.id RETURNING old.name", [clean, tenantId])).rows[0];
    if (!before) throw new AdminError("That workspace no longer exists.");
    await audit(c, scope, tenantId, "workspace.rename", { from: before.name, to: clean });
  });
}

/** The workspace's accent colour (tenants.branding.accent), or null to use the house colour. */
export async function setWorkspaceAccent(session: Session, tenantId: string, accent: string | null): Promise<void> {
  if (accent !== null && !/^#[0-9a-f]{6}$/i.test(accent)) throw new AdminError("Use a colour like #FF3429.");
  await change(session, async (c, scope) => {
    await c.query(
      accent === null
        ? "UPDATE tenants SET branding = branding - 'accent' WHERE id = $1"
        : "UPDATE tenants SET branding = jsonb_set(branding, '{accent}', to_jsonb($2::text)) WHERE id = $1",
      accent === null ? [tenantId] : [tenantId, accent.toUpperCase()],
    );
    await audit(c, scope, tenantId, "workspace.accent", { accent });
  });
}

/** Roles a workspace can be given: Admin and Coach only in the owner's organisation, Client elsewhere. */
export function rolesFor(session: Session, tenantId: string): Role[] {
  return tenantId === session.tenantId ? ["coach", "owner_admin"] : ["client"];
}

export async function inviteUser(
  session: Session,
  tenantId: string,
  email: string,
  role: Role,
): Promise<{ userId: string; status: string; workspace: string; existing: boolean; role: Role } | null> {
  if (!rolesFor(session, tenantId).includes(role)) {
    throw new AdminError(
      tenantId === session.tenantId
        ? "People of your own organisation are invited as a coach or an admin."
        : "A client's workspace only takes clients. Coaches and admins join your own organisation, and coaches are then assigned here.",
    );
  }
  // Invite = create the user record in 'invited' state; the caller emails the
  // invite link (v1 is email-invite only). Inviting an address twice returns
  // the existing record, so the email can be sent again.
  return change(session, async (c, scope) => {
    const created = (
      await c.query(
        `INSERT INTO users (tenant_id, email, role, status, invited_by)
         VALUES ($1,$2,$3,'invited',$4)
         ON CONFLICT (tenant_id, email) DO NOTHING RETURNING id`,
        [tenantId, email, role, scope.userId],
      )
    ).rowCount;
    const row = (
      await c.query<{ id: string; status: string; role: Role; workspace: string }>(
        `SELECT u.id, u.status, u.role, t.name AS workspace FROM users u JOIN tenants t ON t.id = u.tenant_id
          WHERE u.tenant_id = $1 AND u.email = $2`,
        [tenantId, email],
      )
    ).rows[0];
    // What was actually recorded: a repeat invite keeps the existing role.
    await audit(c, scope, tenantId, created ? "user.invite" : "user.reinvite", { email, role: row?.role ?? role });
    return row ? { userId: row.id, status: row.status, workspace: row.workspace, existing: !created, role: row.role } : null;
  });
}

async function memberOf(c: PoolClient, userId: string) {
  const m = (
    await c.query<{ id: string; tenant_id: string; email: string; role: Role; status: string; seen: boolean }>(
      "SELECT id, tenant_id, email, role, status, last_seen_at IS NOT NULL AS seen FROM users WHERE id = $1",
      [userId],
    )
  ).rows[0];
  if (!m) throw new AdminError("That person no longer exists.");
  return m;
}

/**
 * Turn someone's access off or back on. Off takes effect on their next click
 * (sessions re-read the account). A pending invite that is turned off can no
 * longer be accepted; turned back on, it is pending again.
 */
export async function setMemberAccess(session: Session, userId: string, on: boolean): Promise<void> {
  if (userId === session.userId) throw new AdminError("You can't turn off your own access.");
  await change(session, async (c, scope) => {
    const m = await memberOf(c, userId);
    const next = on ? (m.seen ? "active" : "invited") : "disabled";
    await c.query("UPDATE users SET status = $1 WHERE id = $2", [next, userId]);
    if (!on) await c.query("DELETE FROM coach_assignments WHERE coach_user_id = $1", [userId]);
    await audit(c, scope, m.tenant_id, on ? "user.enable" : m.status === "invited" ? "user.revoke_invite" : "user.disable", { email: m.email, status: next });
  });
}

/** Admin or coach, for people of the owner's organisation. Clients keep their one role. */
export async function setMemberRole(session: Session, userId: string, role: Role): Promise<void> {
  if (userId === session.userId) throw new AdminError("You can't change your own role. Ask another admin.");
  await change(session, async (c, scope) => {
    const m = await memberOf(c, userId);
    if (!rolesFor(session, m.tenant_id).includes(role) || m.role === "client") {
      throw new AdminError("Only people of your own organisation can switch between coach and admin.");
    }
    await c.query("UPDATE users SET role = $1 WHERE id = $2", [role, userId]);
    // An admin sees everything; assignments only mean something for coaches.
    if (role === "owner_admin") await c.query("DELETE FROM coach_assignments WHERE coach_user_id = $1", [userId]);
    await audit(c, scope, m.tenant_id, "user.role", { email: m.email, from: m.role, to: role });
  });
}

export async function assignCoach(
  session: Session,
  tenantId: string,
  coachUserId: string,
): Promise<void> {
  await change(session, async (c, scope) => {
    const coach = (
      await c.query<{ email: string }>(
        "SELECT email FROM users WHERE id = $1 AND role = 'coach' AND status = 'active' AND tenant_id = $2",
        [coachUserId, session.tenantId],
      )
    ).rows[0];
    if (!coach) throw new AdminError("Only an active coach of your own organisation can be assigned.");
    await c.query(
      `INSERT INTO coach_assignments (tenant_id, coach_user_id, assigned_by)
       VALUES ($1,$2,$3) ON CONFLICT (tenant_id, coach_user_id) DO NOTHING`,
      [tenantId, coachUserId, scope.userId],
    );
    await audit(c, scope, tenantId, "coach.assign", { coachUserId, email: coach.email });
  });
}

export async function unassignCoach(session: Session, tenantId: string, coachUserId: string): Promise<void> {
  await change(session, async (c, scope) => {
    await c.query("DELETE FROM coach_assignments WHERE tenant_id = $1 AND coach_user_id = $2", [tenantId, coachUserId]);
    await audit(c, scope, tenantId, "coach.unassign", { coachUserId });
  });
}

export interface AuditRow {
  at: string;
  action: string;
  actor: string | null;
  workspace: string | null;
  target: Record<string, unknown>;
}

/** The latest admin changes, newest first, for the audit view. */
export async function listAuditLog(session: Session, limit = 60): Promise<AuditRow[]> {
  const scope = scopeOf(session);
  return (
    await withTenantSession(scope, (c) =>
      c.query<{ created_at: Date; action: string; actor: string | null; workspace: string | null; target: Record<string, unknown> }>(
        `SELECT l.created_at, l.action, u.email AS actor, t.name AS workspace, l.target
           FROM admin_audit_log l
           LEFT JOIN users u ON u.id = l.actor_user_id
           LEFT JOIN tenants t ON t.id = l.tenant_id
          ORDER BY l.created_at DESC LIMIT $1`,
        [limit],
      ),
    )
  ).rows.map((r) => ({ at: new Date(r.created_at).toISOString(), action: r.action, actor: r.actor, workspace: r.workspace, target: r.target ?? {} }));
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
 * Set a workspace's monthly caps (brief §4.6, TASKS P3-9). Null (an empty
 * field) means no limit; 0 switches that kind of generation off. Audited,
 * because a cap change is a cost decision (§07).
 */
export async function setUsageCaps(session: Session, tenantId: string, caps: Omit<CapsRow, "tenantId">): Promise<void> {
  for (const v of Object.values(caps)) {
    if (v !== null && (!Number.isFinite(v) || v < 0)) throw new AdminError("Caps are whole numbers, 0 or more. Leave a field empty for no limit.");
  }
  const clean = (n: number | null) => (n === null ? null : Math.round(n));
  const next = { textSoft: clean(caps.textSoft), textHard: clean(caps.textHard), imageSoft: clean(caps.imageSoft), imageHard: clean(caps.imageHard) };
  if (next.textSoft !== null && next.textHard !== null && next.textSoft > next.textHard) throw new AdminError("The text warning has to come before the stop: set \"warn at\" no higher than \"stop at\".");
  if (next.imageSoft !== null && next.imageHard !== null && next.imageSoft > next.imageHard) throw new AdminError("The image warning has to come before the stop: set \"warn at\" no higher than \"stop at\".");
  await change(session, async (c, scope) => {
    await c.query(
      `INSERT INTO tenant_usage_caps (tenant_id, monthly_text_soft, monthly_text_hard, monthly_image_soft, monthly_image_hard, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id) DO UPDATE SET
         monthly_text_soft = EXCLUDED.monthly_text_soft, monthly_text_hard = EXCLUDED.monthly_text_hard,
         monthly_image_soft = EXCLUDED.monthly_image_soft, monthly_image_hard = EXCLUDED.monthly_image_hard,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, next.textSoft, next.textHard, next.imageSoft, next.imageHard, scope.userId],
    );
    await audit(c, scope, tenantId, "caps.update", next);
  });
}

export interface TemplateVersionRow {
  id: string;
  tenantId: string | null;
  key: string;
  version: number;
  body: string;
  createdAt: string;
  createdBy: string | null;
}

/** Every saved template version, newest first within a key, for the admin page. */
export async function listTemplateVersions(session: Session): Promise<TemplateVersionRow[]> {
  const scope = scopeOf(session);
  return (
    await withTenantSession(scope, (c) =>
      c.query(
        `SELECT t.id, t.tenant_id, t.key, t.version, t.body, t.created_at, u.email AS created_by
           FROM prompt_templates t LEFT JOIN users u ON u.id = t.created_by
          WHERE t.is_active
          ORDER BY t.key, t.tenant_id NULLS FIRST, t.version DESC`,
      ),
    )
  ).rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    key: r.key,
    version: r.version,
    body: r.body,
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by ?? null,
  }));
}

/**
 * Save a template as a NEW version (brief §05: edited and versioned without a
 * redeploy). Nothing is overwritten: every draft keeps the version it was
 * written with, and an older body can be saved again to go back. A tenant id
 * makes it that workspace's override; null edits the global one. Audited.
 */
export async function saveTemplate(session: Session, input: { key: string; body: string; tenantId: string | null }): Promise<number> {
  const body = input.body.trim();
  if (!body) throw new Error("empty template");
  return change(session, async (c, scope) => {
    const next =
      (
        await c.query<{ v: number }>(
          `SELECT coalesce(max(version), 0)::int + 1 AS v FROM prompt_templates WHERE key = $1 AND tenant_id IS NOT DISTINCT FROM $2`,
          [input.key, input.tenantId],
        )
      ).rows[0].v;
    await c.query(
      `INSERT INTO prompt_templates (tenant_id, key, version, body, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [input.tenantId, input.key, next, body, scope.userId],
    );
    // A global edit is audited against the admin's own org; an override against its workspace.
    await audit(c, scope, input.tenantId ?? session.tenantId, "template.update", { key: input.key, version: next, scope: input.tenantId ? "workspace" : "global" });
    return next;
  });
}

/**
 * Drop a workspace's override so it follows the global template again. The
 * versions are kept (inactive), so drafts still show what wrote them.
 */
export async function removeTemplateOverride(session: Session, tenantId: string, key: string): Promise<void> {
  await change(session, async (c, scope) => {
    await c.query("UPDATE prompt_templates SET is_active = false WHERE tenant_id = $1 AND key = $2", [tenantId, key]);
    await audit(c, scope, tenantId, "template.override_removed", { key });
  });
}

export async function setWorkspaceStatus(
  session: Session,
  tenantId: string,
  status: "active" | "archived",
): Promise<void> {
  if (status === "archived" && tenantId === session.tenantId) {
    throw new AdminError("This is your own organisation; archiving it would lock every admin and coach out.");
  }
  await change(session, async (c, scope) => {
    await c.query("UPDATE tenants SET status=$1 WHERE id=$2", [status, tenantId]);
    await audit(c, scope, tenantId, "workspace.status", { status });
  });
}
