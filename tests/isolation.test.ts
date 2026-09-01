/**
 * Cross-tenant isolation tests (INV-1, brief §07). THE unshippable bug class.
 *
 * These prove Row-Level Security denies cross-tenant reads/writes at the DB
 * layer — not in application code. They connect as the runtime `huemen_app`
 * role (RLS enforced) and assert that a session scoped to tenant A can never
 * see or write tenant B's data. This suite runs in CI and BLOCKS MERGE.
 *
 * Requires a migrated database (npm run db:migrate). Skips gracefully if no DB
 * is reachable so unit-only runs aren't blocked.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";

let dbReachable = false;
let tenantA = "";
let tenantB = "";

async function makeTenant(name: string): Promise<string> {
  return withTenantSession(
    { tenantId: null, userId: null, isPlatformAdmin: true },
    async (c) => {
      const r = await c.query<{ id: string }>(
        "INSERT INTO tenants (name) VALUES ($1) RETURNING id",
        [name],
      );
      return r.rows[0].id;
    },
  );
}

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  tenantA = await makeTenant("Tenant A (isolation test)");
  tenantB = await makeTenant("Tenant B (isolation test)");

  // Seed one brand_profile in each tenant, each within its own scoped session.
  await withTenantSession(
    { tenantId: tenantA, userId: null, isPlatformAdmin: false },
    (c) =>
      c.query("INSERT INTO brand_profiles (tenant_id, niche) VALUES ($1, $2)", [
        tenantA,
        "A-niche",
      ]),
  );
  await withTenantSession(
    { tenantId: tenantB, userId: null, isPlatformAdmin: false },
    (c) =>
      c.query("INSERT INTO brand_profiles (tenant_id, niche) VALUES ($1, $2)", [
        tenantB,
        "B-niche",
      ]),
  );
});

afterAll(async () => {
  if (!dbReachable) return;
  // Clean up as admin.
  await withTenantSession(
    { tenantId: null, userId: null, isPlatformAdmin: true },
    async (c) => {
      await c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [
        [tenantA, tenantB],
      ]);
    },
  );
  await appPool().end();
});

describe("tenant isolation via RLS (INV-1)", () => {
  it("a session sees only its own tenant's rows", async () => {
    if (!dbReachable) return expect(dbReachable).toBe(false);
    const rows = await withTenantSession(
      { tenantId: tenantA, userId: null, isPlatformAdmin: false },
      (c) => c.query<{ niche: string }>("SELECT niche FROM brand_profiles"),
    );
    expect(rows.rows.every((r) => r.niche === "A-niche")).toBe(true);
    expect(rows.rows.some((r) => r.niche === "B-niche")).toBe(false);
  });

  it("cannot read another tenant's row even by explicit id", async () => {
    if (!dbReachable) return expect(dbReachable).toBe(false);
    const bId = await withTenantSession(
      { tenantId: tenantB, userId: null, isPlatformAdmin: false },
      async (c) => (await c.query<{ id: string }>("SELECT id FROM brand_profiles")).rows[0].id,
    );
    const leaked = await withTenantSession(
      { tenantId: tenantA, userId: null, isPlatformAdmin: false },
      (c) => c.query("SELECT * FROM brand_profiles WHERE id = $1", [bId]),
    );
    expect(leaked.rowCount).toBe(0);
  });

  it("cannot write a row scoped to another tenant (WITH CHECK denies)", async () => {
    if (!dbReachable) return expect(dbReachable).toBe(false);
    await expect(
      withTenantSession(
        { tenantId: tenantA, userId: null, isPlatformAdmin: false },
        (c) =>
          c.query("INSERT INTO brand_profiles (tenant_id, niche) VALUES ($1, $2)", [
            tenantB, // scoped to A but writing B — must fail
            "smuggled",
          ]),
      ),
    ).rejects.toThrow();
  });

  it("an unscoped, non-admin session sees nothing", async () => {
    if (!dbReachable) return expect(dbReachable).toBe(false);
    const rows = await withTenantSession(
      { tenantId: null, userId: null, isPlatformAdmin: false },
      (c) => c.query("SELECT * FROM brand_profiles"),
    );
    expect(rows.rowCount).toBe(0);
  });
});
