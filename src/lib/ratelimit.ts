/**
 * Short-window limits (migration 0017). The monthly cap stops a workspace that
 * spends too much over a month; this stops a burst: one person, or a stuck
 * loop, firing model calls faster than anyone writes, or asking for sign-in
 * emails again and again.
 *
 * Counted in Postgres, not memory, because serverless instances share nothing.
 * A transaction-scoped advisory lock per workspace and bucket makes the count
 * and the insert one step, so ten requests arriving together cannot all see
 * "nine so far" and all get through. The lock is released at commit, which
 * also works through a transaction-mode pooler (Supabase :6543).
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import { RateLimitError } from "@/lib/ai/errors";

export interface RateRule {
  /** Most hits per person in the window. 0 or unset: no per-person limit. */
  perUser?: number;
  /** Most hits for the whole workspace in the window. 0 or unset: no limit. */
  perTenant?: number;
  windowSeconds: number;
}

/**
 * Lets one hit through or throws RateLimitError. A refused hit is not
 * recorded, so waiting out the window always works.
 */
export async function takeHit(
  who: { tenantId: string | null; userId: string | null },
  bucket: string,
  rule: RateRule,
): Promise<void> {
  if (!who.tenantId || (!rule.perUser && !rule.perTenant)) return;
  const tenantId = who.tenantId;
  await withTenantSession({ tenantId, userId: who.userId, isPlatformAdmin: false }, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`rate:${tenantId}:${bucket}`]);
    const { rows } = await c.query<{ tenant: number; mine: number; waitUser: number | null; waitTenant: number | null }>(
      `SELECT count(*)::int AS tenant,
              count(*) FILTER (WHERE user_id = $3)::int AS mine,
              ceil(extract(epoch FROM min(created_at) FILTER (WHERE user_id = $3) + make_interval(secs => $2) - now()))::int AS "waitUser",
              ceil(extract(epoch FROM min(created_at) + make_interval(secs => $2) - now()))::int AS "waitTenant"
         FROM rate_hits
        WHERE tenant_id = $1 AND bucket = $4 AND created_at > now() - make_interval(secs => $2)`,
      [tenantId, rule.windowSeconds, who.userId, bucket],
    );
    const r = rows[0];
    if (rule.perUser && who.userId && r.mine >= rule.perUser) {
      throw new RateLimitError(bucket, "user", Math.max(1, r.waitUser ?? rule.windowSeconds));
    }
    if (rule.perTenant && r.tenant >= rule.perTenant) {
      throw new RateLimitError(bucket, "workspace", Math.max(1, r.waitTenant ?? rule.windowSeconds));
    }
    await c.query("INSERT INTO rate_hits (tenant_id, user_id, bucket) VALUES ($1, $2, $3)", [tenantId, who.userId, bucket]);
    await c.query("DELETE FROM rate_hits WHERE tenant_id = $1 AND created_at < now() - interval '1 day'", [tenantId]);
  });
}
