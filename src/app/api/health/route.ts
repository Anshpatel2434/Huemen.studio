/**
 * GET /api/health — for uptime monitors and the host's health checks.
 * 200 when the app can reach its database, 503 when it can't. Says nothing
 * else: no version, no settings, no counts.
 */
import { withTenantSession } from "@/db/session";

export const dynamic = "force-dynamic";

/**
 * A database that is unreachable refuses straight away; one that is wedged —
 * failing over, out of connections, paused — accepts the connection and never
 * answers. Without a bound this endpoint hangs in exactly the case it exists
 * for, and the monitor learns nothing it did not already know from its own
 * timeout. Five seconds is long enough for a cold connection and short enough
 * to still be an answer.
 */
const TIMEOUT_MS = 5000;

export async function GET() {
  try {
    await Promise.race([
      withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: false }, (c) => c.query("SELECT 1")),
      new Promise((_, reject) => setTimeout(() => reject(new Error("no answer in time")), TIMEOUT_MS)),
    ]);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
