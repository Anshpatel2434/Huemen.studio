/**
 * GET /api/health — is this instance able to serve? (brief §05.)
 *
 * For uptime checks and for a platform's own readiness probe, so a deploy
 * that cannot reach its database is caught by the host rather than by the
 * first client to open a page.
 *
 * Deliberately public and deliberately thin. It reports whether the database
 * answered and how long that took — nothing about the schema, the
 * configuration, the version of anything, or how many workspaces exist. An
 * unauthenticated endpoint that describes the deployment is a gift to anyone
 * scanning for one, and the people who need the detail have the logs.
 */
import { appPool } from "@/db/pool";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * A database that is unreachable refuses fast; one that is wedged — failing
 * over, out of connections, paused — accepts and never answers. Without a
 * bound, this endpoint hangs exactly when it is most needed, and a probe
 * learns nothing it did not already know from the timeout. Five seconds is
 * long enough for a cold connection and short enough to be an answer.
 */
const TIMEOUT_MS = 5000;

export async function GET() {
  const started = Date.now();
  try {
    // Cheapest round trip that proves a connection was acquired and answered.
    await Promise.race([
      appPool().query("SELECT 1"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`no answer within ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
      ),
    ]);
    return Response.json(
      { status: "ok", database: "ok", ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    log.error("health.database", err, { ms: Date.now() - started });
    // 503 so a load balancer takes this instance out rather than sending it
    // traffic it cannot serve. The reason stays in the log, not the body.
    return Response.json(
      { status: "unhealthy", database: "unreachable", ms: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
