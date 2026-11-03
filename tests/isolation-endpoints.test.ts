/**
 * Cross-tenant isolation at the REQUEST surface (INV-1, brief §07).
 *
 * `isolation.test.ts` proves row-level security denies a cross-tenant read at
 * the database. This file proves the layer people actually reach: the access
 * gate (`resolveScope`), the page helpers every workspace screen calls, and
 * the route handlers that return bytes. Those were the untested half, and the
 * brief asks for tests "on every endpoint", not on the tables underneath.
 *
 * It also carries a NEGATIVE CONTROL. A suite that only ever asserts "no leak"
 * cannot tell the difference between isolation working and the test being
 * blind. One test here deliberately reads across tenants through a path with
 * no scoping and asserts the other tenant's row IS visible — so if that ever
 * starts returning nothing, the assertions above it have stopped meaning
 * anything and the suite says so.
 *
 * Runs in CI and blocks merge. Skips locally without a database; in CI an
 * unreachable database is a failure (tests/helpers/require-db).
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { noteDbUnreachable } from "./helpers/require-db";

// The session cookie the helpers read. Set per test by `signedInAs`.
let cookieValue: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "huemen_session" && cookieValue ? { value: cookieValue } : undefined),
    set: () => {},
    delete: () => {},
  }),
}));

const ADMIN = { tenantId: null, userId: null, isPlatformAdmin: true } as const;

let dbReachable = false;
let tenantA = "", tenantB = "";
let clientA = "", clientB = "", coach = "", admin = "";
let projectB = "";

async function makeTenant(name: string): Promise<string> {
  return withTenantSession(ADMIN, async (c) =>
    (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id);
}

async function makeUser(tenantId: string, email: string, role: string): Promise<string> {
  return withTenantSession(ADMIN, async (c) =>
    (await c.query<{ id: string }>(
      "INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,$3,'active') RETURNING id",
      [tenantId, email, role],
    )).rows[0].id);
}

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch (err) {
    dbReachable = noteDbUnreachable(err);
    return;
  }
  tenantA = await makeTenant("Endpoint A (test)");
  tenantB = await makeTenant("Endpoint B (test)");
  clientA = await makeUser(tenantA, `a-${Date.now()}@endpoint.test`, "client");
  clientB = await makeUser(tenantB, `b-${Date.now()}@endpoint.test`, "client");
  coach = await makeUser(tenantA, `coach-${Date.now()}@endpoint.test`, "coach");
  admin = await makeUser(tenantA, `admin-${Date.now()}@endpoint.test`, "owner_admin");

  // One project and one brand profile inside B, for A to fail to reach.
  projectB = await withTenantSession({ tenantId: tenantB, userId: null, isPlatformAdmin: false }, async (c) => {
    await c.query("INSERT INTO brand_profiles (tenant_id, niche) VALUES ($1,$2)", [tenantB, "B-only-niche"]);
    return (await c.query<{ id: string }>(
      "INSERT INTO projects (tenant_id, name, stage) VALUES ($1,'B project','ideate') RETURNING id", [tenantB],
    )).rows[0].id;
  });
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession(ADMIN, (c) =>
    c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[tenantA, tenantB]]));
  await appPool().end();
});

/** Mint a real session cookie so the helpers and routes see a signed-in user. */
async function signedInAs(userId: string, tenantId: string, role: string) {
  const { startSession } = await import("@/lib/auth");
  const sets: string[] = [];
  // startSession writes through next/headers; capture what it would set.
  const headers = await import("next/headers");
  const orig = headers.cookies;
  (headers as unknown as { cookies: unknown }).cookies = async () => ({
    get: () => undefined,
    set: (_n: string, v: string) => sets.push(v),
    delete: () => {},
  });
  const version = await withTenantSession(ADMIN, async (c) =>
    Number((await c.query<{ session_version: number }>("SELECT session_version FROM users WHERE id=$1", [userId])).rows[0].session_version));
  await startSession({ userId, tenantId, role: role as "client" | "coach" | "owner_admin", email: "x@test" }, version);
  (headers as unknown as { cookies: unknown }).cookies = orig;
  cookieValue = sets[0] ?? null;
}

/** next's notFound()/redirect() throw; this reports which one happened. */
async function outcome(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "allowed";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/.test(msg)) return "not-found";
    if (/NEXT_REDIRECT/.test(msg)) return "redirect";
    if (/FORBIDDEN/.test(msg)) return "forbidden";
    return `threw:${msg}`;
  }
}

describe("the access gate (resolveScope) — INV-1 second line", () => {
  it("lets a client into their own workspace and no other", async () => {
    if (!dbReachable) return;
    const { resolveScope, ForbiddenError } = await import("@/lib/auth/scope");
    const session = { userId: clientA, tenantId: tenantA, role: "client" as const, email: "a@test" };

    const own = await resolveScope(session, tenantA);
    expect(own.tenantId).toBe(tenantA);
    expect(own.isPlatformAdmin).toBe(false);

    await expect(resolveScope(session, tenantB)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a coach a workspace they are not assigned to, and allows one they are", async () => {
    if (!dbReachable) return;
    const { resolveScope, ForbiddenError } = await import("@/lib/auth/scope");
    const session = { userId: coach, tenantId: tenantA, role: "coach" as const, email: "c@test" };

    await expect(resolveScope(session, tenantB)).rejects.toBeInstanceOf(ForbiddenError);

    await withTenantSession(ADMIN, (c) =>
      c.query("INSERT INTO coach_assignments (tenant_id, coach_user_id) VALUES ($1,$2)", [tenantB, coach]));
    const now = await resolveScope(session, tenantB);
    expect(now.tenantId).toBe(tenantB);

    await withTenantSession(ADMIN, (c) =>
      c.query("DELETE FROM coach_assignments WHERE tenant_id=$1 AND coach_user_id=$2", [tenantB, coach]));
    await expect(resolveScope(session, tenantB)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("gives even a platform admin a tenant-bound scope for content", async () => {
    if (!dbReachable) return;
    const { resolveScope } = await import("@/lib/auth/scope");
    const session = { userId: admin, tenantId: tenantA, role: "owner_admin" as const, email: "ad@test" };
    const scope = await resolveScope(session, tenantB);
    // resolveScope hands admins the bypass; workspaceScope strips it, which is
    // what keeps client content tables admin-proof. Both are asserted here.
    expect(scope.isPlatformAdmin).toBe(true);

    await signedInAs(admin, tenantA, "owner_admin");
    const { workspaceScope } = await import("@/lib/auth/workspace");
    const { scope: pageScope } = await workspaceScope(tenantB);
    expect(pageScope.isPlatformAdmin).toBe(false);
  });
});

describe("page helpers every workspace screen calls", () => {
  it("404s a client asking for another workspace", async () => {
    if (!dbReachable) return;
    await signedInAs(clientA, tenantA, "client");
    const { workspaceScope } = await import("@/lib/auth/workspace");
    expect(await outcome(() => workspaceScope(tenantB))).toBe("not-found");
    expect(await outcome(() => workspaceScope(tenantA))).toBe("allowed");
  });

  it("404s another tenant's project id, even from inside a workspace you own", async () => {
    if (!dbReachable) return;
    await signedInAs(clientA, tenantA, "client");
    const { projectScope } = await import("@/lib/auth/workspace");
    expect(await outcome(() => projectScope(tenantA, projectB))).toBe("not-found");
    expect(await outcome(() => projectScope(tenantB, projectB))).toBe("not-found");
  });

  it("sends a signed-out visitor to sign in rather than leaking the answer", async () => {
    if (!dbReachable) return;
    cookieValue = null;
    const { workspaceScope } = await import("@/lib/auth/workspace");
    expect(await outcome(() => workspaceScope(tenantB))).toBe("redirect");
  });
});

describe("route handlers that return bytes", () => {
  it("refuses another tenant's export to a signed-in client of A", async () => {
    if (!dbReachable) return;
    await signedInAs(clientA, tenantA, "client");
    const { GET } = await import("@/app/w/[id]/p/[pid]/export/markdown/route");
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: tenantB, pid: projectB }),
    } as never);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("B-only-niche");
  });

  it("refuses the export with no session at all", async () => {
    if (!dbReachable) return;
    cookieValue = null;
    const { GET } = await import("@/app/w/[id]/p/[pid]/export/markdown/route");
    const res = await GET(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: tenantB, pid: projectB }),
    } as never);
    expect(res.status).toBe(401);
  });

  it("serves a stored file only to a signature minted for that exact key", async () => {
    if (!dbReachable) return;
    const { signKey } = await import("@/lib/storage");
    const keyA = `tenants/${tenantA}/assets/a.png`;
    const keyB = `tenants/${tenantB}/assets/b.png`;
    const { GET } = await import("@/app/api/storage/[...key]/route");
    const { NextRequest } = await import("next/server");

    // A's token against B's key: refused before any storage read.
    const expiry = Date.now() + 60_000;
    const tokenForA = `${expiry}.${signKey(keyA, expiry)}`;
    const res = await GET(
      new NextRequest(`http://localhost/api/storage/${keyB}?token=${tokenForA}`),
      { params: Promise.resolve({ key: keyB.split("/") }) },
    );
    expect(res.status).toBe(403);

    // A tampered token for its own key is refused too.
    const res2 = await GET(
      new NextRequest(`http://localhost/api/storage/${keyA}?token=${tokenForA.slice(0, -1)}x`),
      { params: Promise.resolve({ key: keyA.split("/") }) },
    );
    expect(res2.status).toBe(403);
  });
});

describe("negative control — proof these assertions can see a leak", () => {
  it("sees the row under its OWN tenant's scope", async () => {
    if (!dbReachable) return;
    // The exact query the next test asserts returns nothing for A. Under B's
    // own scope it MUST return the row. Without this, "A sees nothing" would
    // also be satisfied by an empty table, a failed seed or a typo in the
    // niche — i.e. by the test being blind rather than isolation holding.
    const own = await withTenantSession({ tenantId: tenantB, userId: null, isPlatformAdmin: false }, (c) =>
      c.query<{ niche: string }>("SELECT niche FROM brand_profiles WHERE tenant_id = $1", [tenantB]));
    expect(own.rows.map((r) => r.niche)).toContain("B-only-niche");
  });

  it("and sees nothing when the same read is scoped to A", async () => {
    if (!dbReachable) return;
    const scoped = await withTenantSession({ tenantId: tenantA, userId: null, isPlatformAdmin: false }, (c) =>
      c.query<{ niche: string }>("SELECT niche FROM brand_profiles WHERE tenant_id = $1", [tenantB]));
    expect(scoped.rows).toHaveLength(0);
  });

  it("keeps client content out of reach even for a platform admin", async () => {
    if (!dbReachable) return;
    // Worth pinning: migration 0002 gives the admin bypass to admin-managed
    // tables only. Client content has no admin policy, so an admin-code bug
    // cannot read one client's brief while serving another.
    const asAdmin = await withTenantSession(ADMIN, (c) =>
      c.query<{ niche: string }>("SELECT niche FROM brand_profiles WHERE tenant_id = $1", [tenantB]));
    expect(asAdmin.rows).toHaveLength(0);
  });
});
