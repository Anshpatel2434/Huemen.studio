/**
 * Short-window limits (0017, lib/ratelimit): a person or a workspace gets so
 * many hits per window, refused hits are not counted, a burst arriving at once
 * cannot slip past the count, and one workspace's hits are invisible to another.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { takeHit } from "@/lib/ratelimit";
import { RateLimitError, userMessage } from "@/lib/ai/errors";

let ok = false;
const tenants: string[] = [];
const users: string[] = [];
const ADMIN = { tenantId: null, userId: null, isPlatformAdmin: true };

beforeAll(async () => {
  try {
    const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await p.query("SELECT 1 FROM rate_hits LIMIT 1");
    await p.end();
    ok = true;
  } catch {
    return;
  }
  await withTenantSession(ADMIN, async (c) => {
    for (const name of ["rate-a", "rate-b"]) {
      tenants.push((await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id);
    }
    for (const n of [1, 2]) {
      users.push(
        (
          await c.query<{ id: string }>(
            "INSERT INTO users (tenant_id, email, role, status) VALUES ($1, $2, 'client', 'active') RETURNING id",
            [tenants[0], `rate${n}-${Date.now()}@example.test`],
          )
        ).rows[0].id,
      );
    }
  });
});

afterAll(async () => {
  if (!ok) return;
  await withTenantSession(ADMIN, (c) => c.query("DELETE FROM tenants WHERE id = ANY($1)", [tenants]));
  await appPool().end();
});

const refused = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e) => (e instanceof RateLimitError ? e : Promise.reject(e)),
  );

describe("short-window limits", () => {
  it("lets a person through up to the limit, then says how long to wait", async () => {
    if (!ok) return expect(ok).toBe(false);
    const me = { tenantId: tenants[0], userId: users[0] };
    for (let i = 0; i < 3; i++) await takeHit(me, "t-user", { perUser: 3, windowSeconds: 60 });
    const e = await refused(takeHit(me, "t-user", { perUser: 3, windowSeconds: 60 }));
    expect(e?.by).toBe("user");
    expect(e!.retryAfterSeconds).toBeGreaterThan(0);
    expect(e!.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(userMessage(e)).toMatch(/Give it a minute/);
    // Someone else in the same workspace has their own allowance.
    await takeHit({ tenantId: tenants[0], userId: users[1] }, "t-user", { perUser: 3, windowSeconds: 60 });
  });

  it("caps the workspace as a whole, and refused hits are not counted", async () => {
    if (!ok) return expect(ok).toBe(false);
    const rule = { perUser: 10, perTenant: 2, windowSeconds: 60 };
    await takeHit({ tenantId: tenants[0], userId: users[0] }, "t-ws", rule);
    await takeHit({ tenantId: tenants[0], userId: users[1] }, "t-ws", rule);
    for (let i = 0; i < 3; i++) {
      expect((await refused(takeHit({ tenantId: tenants[0], userId: users[0] }, "t-ws", rule)))?.by).toBe("workspace");
    }
    const n = await withTenantSession({ tenantId: tenants[0], userId: null, isPlatformAdmin: false }, (c) =>
      c.query<{ n: number }>("SELECT count(*)::int AS n FROM rate_hits WHERE bucket = 't-ws'"),
    );
    expect(n.rows[0].n).toBe(2);
  });

  it("holds under a burst: ten at once against a limit of four lets exactly four through", async () => {
    if (!ok) return expect(ok).toBe(false);
    const me = { tenantId: tenants[0], userId: users[0] };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => refused(takeHit(me, "t-burst", { perUser: 4, windowSeconds: 60 }))),
    );
    expect(results.filter((r) => r === null)).toHaveLength(4);
  });

  it("forgets hits once the window has passed", async () => {
    if (!ok) return expect(ok).toBe(false);
    const me = { tenantId: tenants[0], userId: users[0] };
    await takeHit(me, "t-window", { perUser: 1, windowSeconds: 1 });
    expect(await refused(takeHit(me, "t-window", { perUser: 1, windowSeconds: 1 }))).not.toBeNull();
    await new Promise((r) => setTimeout(r, 1100));
    await takeHit(me, "t-window", { perUser: 1, windowSeconds: 1 });
  });

  it("keeps each workspace's hits to itself (INV-1)", async () => {
    if (!ok) return expect(ok).toBe(false);
    const seen = await withTenantSession({ tenantId: tenants[1], userId: null, isPlatformAdmin: false }, (c) =>
      c.query("SELECT 1 FROM rate_hits WHERE tenant_id = $1", [tenants[0]]),
    );
    expect(seen.rowCount).toBe(0);
    await expect(
      withTenantSession({ tenantId: tenants[1], userId: null, isPlatformAdmin: false }, (c) =>
        c.query("INSERT INTO rate_hits (tenant_id, bucket) VALUES ($1, 'x')", [tenants[0]]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
