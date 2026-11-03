/**
 * Whether a database-backed test is allowed to skip.
 *
 * Most suites open with `if (!dbReachable) return;` so you can run `npm test`
 * on a laptop with Docker off. That is a convenience with a sharp edge: the
 * cross-tenant isolation suite — the one the brief calls the unshippable bug
 * class — would report a green run having asserted nothing at all.
 *
 * So the skip is allowed locally and refused anywhere it would be a lie: in
 * CI, or when REQUIRE_DB=1. There, an unreachable database fails the run with
 * the connection error instead of quietly passing.
 */
export function dbSkipAllowed(): boolean {
  return !(process.env.CI || process.env.REQUIRE_DB === "1");
}

/**
 * Call from a suite's `beforeAll` when the connection failed. Returns false
 * (so the suite can skip) locally, and throws in CI.
 */
export function noteDbUnreachable(err: unknown): false {
  if (!dbSkipAllowed()) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Database unreachable and skipping is not allowed here (CI or REQUIRE_DB=1). ` +
        `These suites prove tenant isolation; a green run without them means nothing. ` +
        `Original error: ${why}`,
    );
  }
  return false;
}
