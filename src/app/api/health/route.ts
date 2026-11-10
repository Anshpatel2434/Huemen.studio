/**
 * GET /api/health — for uptime monitors and the host's health checks.
 * 200 when the app can reach its database, 503 when it can't. Says nothing
 * else: no version, no settings, no counts.
 */
import { withTenantSession } from "@/db/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: false }, (c) => c.query("SELECT 1"));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
