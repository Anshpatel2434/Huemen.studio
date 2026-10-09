/**
 * Tenant-scoped database sessions — the application-side half of tenant
 * isolation (INV-1). RLS in Postgres is the primary line of defence; this helper
 * guarantees a verified tenant scope is set on the connection for every query so
 * those policies have something to key on.
 *
 * Every request-serving query MUST run inside `withTenantSession`. Never query
 * `appPool()` directly. The tenant/user/admin values come from the VERIFIED
 * session (see src/lib/auth), never from client input.
 *
 * GUCs are set with `set_config(..., true)` — transaction-LOCAL and safely
 * parameterised (no string interpolation into SQL).
 *
 * Used by both the Next server runtime and CLI scripts (migrate/seed), so it
 * deliberately does not use the `server-only` guard.
 */
import type { PoolClient } from "pg";
import { appPool } from "./pool";

export interface SessionScope {
  /** Workspace being accessed. `null` only for platform-admin global reads. */
  tenantId: string | null;
  /** Authenticated user id (for audit + created_by columns). */
  userId: string | null;
  /** True for Owner/Admin platform users (brief §02). Enables admin policies. */
  isPlatformAdmin: boolean;
}

/**
 * The database can't be reached (not started, wrong port, network). Node
 * reports a refused connection to a host with two addresses (::1 and
 * 127.0.0.1) as an AggregateError, which the Next dev server fails to
 * serialise: the page goes blank and the real cause is buried. A plain Error
 * with the cause spelled out reaches the error boundary and the log intact.
 */
export class DatabaseUnavailableError extends Error {
  constructor(public readonly code: string) {
    super(`Can't reach the database (${code}). Is it running? Start it with \`npm run db:up\` (Docker must be running).`);
    this.name = "DatabaseUnavailableError";
  }
}

async function connect(): Promise<PoolClient> {
  try {
    return await appPool().connect();
  } catch (err) {
    const e = err as { code?: string; errors?: { code?: string }[] };
    throw new DatabaseUnavailableError(e.code ?? e.errors?.[0]?.code ?? (err instanceof Error ? err.message : "unknown"));
  }
}

export async function withTenantSession<T>(
  scope: SessionScope,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [
      scope.tenantId ?? "",
    ]);
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [
      scope.userId ?? "",
    ]);
    await client.query(
      "SELECT set_config('app.is_platform_admin', $1, true)",
      [scope.isPlatformAdmin ? "true" : "false"],
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
