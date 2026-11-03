/**
 * Account lookups for the sign-in and invite pages. These run before anyone
 * is signed in, so they use the platform-admin DB scope, and they only ever
 * read or change the single user row named by an email or a verified link.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import type { Role } from "@/lib/auth/types";

const ADMIN = { tenantId: null, userId: null, isPlatformAdmin: true } as const;

export interface AccountRow {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantStatus: string;
  email: string;
  role: Role;
  status: "invited" | "active" | "disabled";
  invitedBy: string | null;
  /** Version stamp for one-time sign-in links (see lib/auth/tokens). */
  lastSeen: string;
  /** Bumped to retire every live session cookie for this account (0018). */
  sessionVersion: number;
}

const SELECT = `SELECT u.id, u.tenant_id, t.name AS tenant_name, t.status AS tenant_status, u.email, u.role, u.status,
                       inv.email AS invited_by, u.session_version,
                       coalesce(to_char(u.last_seen_at, 'YYYY-MM-DD"T"HH24:MI:SS.US'), '') AS last_seen
                  FROM users u JOIN tenants t ON t.id = u.tenant_id LEFT JOIN users inv ON inv.id = u.invited_by`;

function row(r: Record<string, string>): AccountRow {
  return {
    id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name, tenantStatus: r.tenant_status, email: r.email,
    role: r.role as Role, status: r.status as AccountRow["status"], invitedBy: r.invited_by, lastSeen: r.last_seen,
    sessionVersion: Number(r.session_version ?? 1),
  };
}

/** The account for an email: active first, then invited, then disabled. */
export async function findAccountByEmail(email: string): Promise<AccountRow | null> {
  const r = await withTenantSession(ADMIN, (c) =>
    c.query(`${SELECT} WHERE lower(u.email) = lower($1)
              ORDER BY CASE u.status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END, u.created_at LIMIT 1`, [email]),
  );
  return r.rows[0] ? row(r.rows[0]) : null;
}

export async function getAccount(id: string): Promise<AccountRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await withTenantSession(ADMIN, (c) => c.query(`${SELECT} WHERE u.id = $1`, [id]));
  return r.rows[0] ? row(r.rows[0]) : null;
}

/** Record a sign-in. Moving last_seen_at retires every earlier sign-in link. */
export async function markSignedIn(id: string): Promise<void> {
  await withTenantSession(ADMIN, (c) => c.query("UPDATE users SET last_seen_at = clock_timestamp() WHERE id = $1", [id]));
}

/** invited → active. Returns false if the invite was already used or revoked. */
export async function activateInvite(id: string): Promise<boolean> {
  const r = await withTenantSession(ADMIN, (c) =>
    c.query("UPDATE users SET status = 'active', last_seen_at = clock_timestamp() WHERE id = $1 AND status = 'invited'", [id]),
  );
  return (r.rowCount ?? 0) > 0;
}

/** Members of a workspace, for the admin console (invite links, status). */
export async function listMembers(tenantIds: string[]): Promise<AccountRow[]> {
  if (!tenantIds.length) return [];
  const r = await withTenantSession(ADMIN, (c) =>
    c.query(`${SELECT} WHERE u.tenant_id = ANY($1::uuid[]) ORDER BY u.status = 'invited' DESC, u.role, u.email`, [tenantIds]),
  );
  return r.rows.map(row);
}

/**
 * The account's current session version, for the per-request revocation check.
 * Null when the account is gone, disabled, or its workspace is archived — all
 * of which must end a live session, not just block the next sign-in.
 */
export async function currentSessionVersion(id: string): Promise<number | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await withTenantSession(ADMIN, (c) =>
    c.query<{ session_version: number }>(
      `SELECT u.session_version FROM users u JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1 AND u.status <> 'disabled' AND t.status <> 'archived'`,
      [id],
    ),
  );
  return r.rows[0] ? Number(r.rows[0].session_version) : null;
}

/** Retire every live session for one account (role change, forced sign-out). */
export async function bumpSessionVersion(id: string): Promise<void> {
  await withTenantSession(ADMIN, (c) =>
    c.query("UPDATE users SET session_version = session_version + 1 WHERE id = $1", [id]),
  );
}

/** Retire every live session in a workspace (archiving it). */
export async function bumpSessionVersionsForTenant(tenantId: string): Promise<void> {
  await withTenantSession(ADMIN, (c) =>
    c.query("UPDATE users SET session_version = session_version + 1 WHERE tenant_id = $1", [tenantId]),
  );
}
