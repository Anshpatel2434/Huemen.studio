/**
 * Postgres connection pools.
 *
 * - `appPool`  — RUNTIME pool. Connects as the non-owner `huemen_app` role so
 *                Row-Level Security is enforced on every query (INV-1). All
 *                request-serving code uses this, and only via `withSession`
 *                (see ./session) so a tenant scope is always set.
 * - admin client — migrations only, owner role, created on demand.
 *
 * Used by both the Next server runtime and CLI scripts (migrate/seed), so it
 * deliberately does not use the `server-only` guard.
 */
import { Pool, type PoolClient } from "pg";
import { getEnv } from "@/lib/env";

let _appPool: Pool | null = null;

/**
 * An idle pooled connection that the server drops (a restart, Docker stopped,
 * a network blip) is reported as an "error" event on the pool. Unhandled, it
 * is an uncaught exception that takes the whole Node process down. The pool
 * has already discarded that connection and opens a fresh one on the next
 * query, so logging it is all that's needed.
 */
function onIdleError(err: Error) {
  console.warn(`[db] an idle connection was closed by the server: ${err.message}`);
}

export function appPool(): Pool {
  if (!_appPool) {
    _appPool = new Pool({
      connectionString: getEnv().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
    _appPool.on("error", onIdleError);
  }
  return _appPool;
}

/** Owner-role client for migrations/bootstrap. Never used to serve requests. */
export function adminPool(): Pool {
  const pool = new Pool({ connectionString: getEnv().DATABASE_ADMIN_URL, max: 4 });
  pool.on("error", onIdleError);
  return pool;
}

export type { PoolClient };
