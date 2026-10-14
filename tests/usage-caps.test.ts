/**
 * Usage caps (brief §4.6, TASKS P3-9): an admin sets a monthly hard cap, the
 * facade refuses the call that would pass it, the refusal is logged, and one
 * tenant's cap never touches another's (INV-1).
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { createProject, type ProjectScope } from "@/lib/data/projects";
import { generateContent, listContent } from "@/lib/data/content";
import { listCaps, setUsageCaps } from "@/lib/data/admin";
import { loadUsage } from "@/lib/data/insights";
import { UsageCapError, userMessage } from "@/lib/ai/errors";
import type { Session } from "@/lib/auth/types";

let dbReachable = false;
let A: ProjectScope;
let B: ProjectScope;
let admin: Session;

beforeAll(async () => {
  try {
    const probe = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await probe.query("SELECT 1");
    await probe.end();
    dbReachable = true;
  } catch {
    return;
  }
  const mk = (name: string) =>
    withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) =>
      (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id,
    );
  const [ta, tb, owner] = [await mk("Caps A (test)"), await mk("Caps B (test)"), await mk("Caps owner (test)")];
  const adminId = await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, async (c) =>
    (await c.query<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,'caps-admin@test.local','owner_admin','active') RETURNING id", [owner])).rows[0].id,
  );
  admin = { userId: adminId, tenantId: owner, role: "owner_admin", email: "caps-admin@test.local" };
  const wa = { tenantId: ta, userId: null, isPlatformAdmin: false };
  const wb = { tenantId: tb, userId: null, isPlatformAdmin: false };
  A = { ...wa, projectId: await createProject(wa, "A") };
  B = { ...wb, projectId: await createProject(wb, "B") };
});

afterAll(async () => {
  if (!dbReachable) return;
  await withTenantSession({ tenantId: null, userId: null, isPlatformAdmin: true }, (c) =>
    c.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [[A.tenantId, B.tenantId, admin.tenantId]]),
  );
  await appPool().end();
});

describe("monthly usage caps", () => {
  it("a hard cap stops the call that would pass it, and is logged, and is audited", async () => {
    if (!dbReachable) return;
    await setUsageCaps(admin, A.tenantId!, { textSoft: 1, textHard: 2, imageSoft: null, imageHard: null });
    expect((await listCaps(admin)).get(A.tenantId!)?.textHard).toBe(2);

    await generateContent(A, { format: "linkedin_post", topic: "one" });
    await generateContent(A, { format: "linkedin_post", topic: "two" });
    expect((await loadUsage(A)).textThisMonth).toBe(2);

    let err: unknown;
    try {
      await generateContent(A, { format: "linkedin_post", topic: "three" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UsageCapError);
    expect(userMessage(err)).toMatch(/used its 2 generations/);
    // Nothing was written, the refusal was logged as a failed call, and the
    // count against the cap did not move.
    expect((await listContent(A)).length).toBe(2);
    const u = await loadUsage(A);
    expect(u.textThisMonth).toBe(2);
    expect(u.errorsThisMonth).toBe(1);

    const audit = await withTenantSession({ ...admin, tenantId: null, isPlatformAdmin: true }, async (c) =>
      (await c.query("SELECT action, target FROM admin_audit_log WHERE tenant_id=$1 AND action='caps.update'", [A.tenantId])).rows,
    );
    expect(audit.length).toBe(1);
    expect(audit[0].target.textHard).toBe(2);
  });

  it("A's cap is A's: B is uncapped, and raising A's cap lets A write again", async () => {
    if (!dbReachable) return;
    await generateContent(B, { format: "linkedin_post", topic: "b one" });
    expect((await listContent(B)).length).toBe(1);

    await setUsageCaps(admin, A.tenantId!, { textSoft: null, textHard: 5, imageSoft: null, imageHard: null });
    await generateContent(A, { format: "linkedin_post", topic: "three, again" });
    expect((await listContent(A)).length).toBe(3);

    // Clearing the cap (empty field) means unlimited, and zero is not a cap.
    await setUsageCaps(admin, A.tenantId!, { textSoft: null, textHard: 0, imageSoft: null, imageHard: null });
    expect((await listCaps(admin)).get(A.tenantId!)?.textHard).toBeNull();
  });
});
