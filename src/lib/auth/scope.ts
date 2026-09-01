/**
 * Access resolution — the SECOND line of tenant isolation (INV-1). Turns a
 * verified Session + a requested workspace into a SessionScope for the DB layer,
 * refusing access the role should not have BEFORE any tenant GUC is set. RLS is
 * still the first line; this refuses early and readably.
 *
 *   - owner_admin : any workspace (platform admin).
 *   - client      : their own workspace only.
 *   - coach       : their home org, or a client workspace they are assigned to.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession, type SessionScope } from "@/db/session";
import { isPlatformAdmin, type Session } from "./types";

export class ForbiddenError extends Error {
  constructor(msg = "FORBIDDEN") {
    super(msg);
    this.name = "ForbiddenError";
  }
}

async function coachIsAssigned(coachUserId: string, tenantId: string): Promise<boolean> {
  // Trusted internal check; runs admin-scoped only to read the assignment row.
  const res = await withTenantSession(
    { tenantId: null, userId: coachUserId, isPlatformAdmin: true },
    (c) =>
      c.query(
        "SELECT 1 FROM coach_assignments WHERE tenant_id = $1 AND coach_user_id = $2",
        [tenantId, coachUserId],
      ),
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Resolve the DB scope for a request. `requestedTenantId` defaults to the user's
 * home tenant when omitted.
 */
export async function resolveScope(
  session: Session,
  requestedTenantId?: string,
): Promise<SessionScope> {
  const target = requestedTenantId ?? session.tenantId;

  if (isPlatformAdmin(session.role)) {
    return { tenantId: target, userId: session.userId, isPlatformAdmin: true };
  }

  if (session.role === "client") {
    if (target !== session.tenantId) throw new ForbiddenError();
    return { tenantId: target, userId: session.userId, isPlatformAdmin: false };
  }

  // coach
  if (target === session.tenantId || (await coachIsAssigned(session.userId, target))) {
    return { tenantId: target, userId: session.userId, isPlatformAdmin: false };
  }
  throw new ForbiddenError();
}

/** Admin-only global scope (no specific workspace), e.g. the admin console. */
export function adminGlobalScope(session: Session): SessionScope {
  if (!isPlatformAdmin(session.role)) throw new ForbiddenError();
  return { tenantId: null, userId: session.userId, isPlatformAdmin: true };
}
