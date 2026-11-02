/**
 * The audit's security fixes, held in place:
 * - production refuses the dev sign-in and the example secret;
 * - questionnaire links expire and only open their own workspace;
 * - every table is under row-level security (checked from the catalog, so a
 *   new table that forgets it fails here);
 * - roles reach only what they should (resolveScope);
 * - admin changes follow the organisation rules and are audited with the change;
 * - a cap of 0 switches generation off.
 * In CI the database tests must actually run: an unreachable database fails.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { parseEnv } from "@/lib/env";
import { signQuestionnaireToken, verifyQuestionnaireToken } from "@/lib/invite/token";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { resolveScope, ForbiddenError } from "@/lib/auth/scope";
import { AdminError, assignCoach, inviteUser, setMemberAccess, setMemberRole, setUsageCaps, setWorkspaceStatus, unassignCoach } from "@/lib/data/admin";
import { enforceCap } from "@/lib/ai";
import { UsageCapError } from "@/lib/ai/errors";
import type { Session } from "@/lib/auth/types";

const BASE = { DATABASE_URL: "postgres://x", DATABASE_ADMIN_URL: "postgres://x", DATABASE_APP_PASSWORD: "x" };
const GOOD_SECRET = "a".repeat(64);

describe("production settings", () => {
  it("refuses the dev sign-in in production", () => {
    expect(() => parseEnv({ ...BASE, NODE_ENV: "production", AUTH_SECRET: GOOD_SECRET })).toThrow(/AUTH_DRIVER=dev/);
  });
  it("allows it only when a throwaway test deploy says so", () => {
    expect(parseEnv({ ...BASE, NODE_ENV: "production", AUTH_SECRET: GOOD_SECRET, AUTH_ALLOW_DEV_SIGNIN: "true" }).AUTH_DRIVER).toBe("dev");
  });
  it("refuses the example secret and short secrets in production", () => {
    const prod = { ...BASE, NODE_ENV: "production", AUTH_DRIVER: "email", MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x", MAIL_FROM: "a@b.co" };
    expect(() => parseEnv({ ...prod, AUTH_SECRET: "CHANGE_ME_32_BYTE_RANDOM_STRING_xxxxx" })).toThrow(/AUTH_SECRET/);
    expect(() => parseEnv({ ...prod, AUTH_SECRET: "0123456789abcdef0123" })).toThrow(/AUTH_SECRET/);
    expect(parseEnv({ ...prod, AUTH_SECRET: GOOD_SECRET }).AUTH_DRIVER).toBe("email");
  });
  it("does not refuse while next build collects pages", () => {
    expect(parseEnv({ ...BASE, NODE_ENV: "production", AUTH_SECRET: "0123456789abcdef0123", NEXT_PHASE: "phase-production-build" }).AUTH_DRIVER).toBe("dev");
  });
  it("keeps local development easy", () => {
    expect(parseEnv({ ...BASE, AUTH_SECRET: "0123456789abcdef0123" }).AUTH_DRIVER).toBe("dev");
  });
});

describe("questionnaire links", () => {
  const t = "11111111-1111-4111-8111-111111111111";
  it("open their own workspace", () => {
    expect(verifyQuestionnaireToken(signQuestionnaireToken(t))).toBe(t);
  });
  it("stop working after 30 days", () => {
    expect(verifyQuestionnaireToken(signQuestionnaireToken(t, Date.now() - 31 * 24 * 3600 * 1000))).toBeNull();
  });
  it("can't be pointed at another workspace or have their date changed", () => {
    const [, exp, sig] = signQuestionnaireToken(t).split(".");
    expect(verifyQuestionnaireToken(`22222222-2222-4222-8222-222222222222.${exp}.${sig}`)).toBeNull();
    expect(verifyQuestionnaireToken(`${t}.${Number(exp) + 1000}.${sig}`)).toBeNull();
    expect(verifyQuestionnaireToken(`${t}.${sig}`)).toBeNull();
  });
});

// ---- Database ----------------------------------------------------------------

let ok = false;
const ADMIN_DB = { tenantId: null, userId: null, isPlatformAdmin: true };
const ids = { org: "", client: "", other: "", admin: "", coach: "", clientUser: "", admin2: "" };
let admin: Session;

beforeAll(async () => {
  try {
    const p = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await p.query("SELECT 1");
    await p.end();
    ok = true;
  } catch {
    return;
  }
  await withTenantSession(ADMIN_DB, async (c) => {
    const t = async (name: string) => (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", [name])).rows[0].id;
    ids.org = await t("sec-org");
    ids.client = await t("sec-client");
    ids.other = await t("sec-other");
    const u = async (tenant: string, role: string, status = "active") =>
      (await c.query<{ id: string }>("INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,$3,$4) RETURNING id", [tenant, `${role}-${Math.random().toString(36).slice(2)}@sec.test`, role, status])).rows[0].id;
    ids.admin = await u(ids.org, "owner_admin");
    ids.admin2 = await u(ids.org, "owner_admin");
    ids.coach = await u(ids.org, "coach");
    ids.clientUser = await u(ids.client, "client");
  });
  admin = { userId: ids.admin, tenantId: ids.org, role: "owner_admin", email: "admin@sec.test" };
});

afterAll(async () => {
  if (!ok) return;
  await withTenantSession(ADMIN_DB, (c) => c.query("DELETE FROM tenants WHERE id = ANY($1)", [[ids.org, ids.client, ids.other]]));
  await appPool().end();
});

describe("the database is really tested", () => {
  it("in CI, an unreachable database is a failure, not a skip", () => {
    if (process.env.CI) expect(ok).toBe(true);
  });
});

describe("row-level security on every table", () => {
  it("every table has tenant_id, RLS enabled AND forced, and a policy", async () => {
    if (!ok) return expect(ok).toBe(false);
    const { rows } = await withTenantSession(ADMIN_DB, (c) =>
      c.query<{ table: string; rls: boolean; forced: boolean; policies: number; tenant_col: boolean }>(
        `SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
                (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies,
                EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.relname AND k.column_name = 'tenant_id') AS tenant_col
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '_migrations'
          ORDER BY 1`,
      ),
    );
    expect(rows.length).toBeGreaterThan(20);
    // tenants is the tenant table itself: keyed by id, not tenant_id.
    const bad = rows.filter((r) => !r.rls || !r.forced || r.policies === 0 || (!r.tenant_col && r.table !== "tenants"));
    expect(bad).toEqual([]);
  });
  it("no views (a view runs as its owner and skips RLS)", async () => {
    if (!ok) return expect(ok).toBe(false);
    const { rows } = await withTenantSession(ADMIN_DB, (c) => c.query("SELECT viewname FROM pg_views WHERE schemaname = 'public'"));
    expect(rows).toEqual([]);
  });
});

describe("who can reach which workspace", () => {
  it("a client reaches only their own", async () => {
    if (!ok) return expect(ok).toBe(false);
    const client: Session = { userId: ids.clientUser, tenantId: ids.client, role: "client", email: "c@sec.test" };
    expect((await resolveScope(client, ids.client)).tenantId).toBe(ids.client);
    await expect(resolveScope(client, ids.other)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("a coach reaches a client workspace only while assigned", async () => {
    if (!ok) return expect(ok).toBe(false);
    const coach: Session = { userId: ids.coach, tenantId: ids.org, role: "coach", email: "k@sec.test" };
    await expect(resolveScope(coach, ids.client)).rejects.toBeInstanceOf(ForbiddenError);
    await assignCoach(admin, ids.client, ids.coach);
    expect((await resolveScope(coach, ids.client)).isPlatformAdmin).toBe(false);
    await unassignCoach(admin, ids.client, ids.coach);
    await expect(resolveScope(coach, ids.client)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("admin changes", () => {
  it("never invites an admin or coach into a client's workspace", async () => {
    if (!ok) return expect(ok).toBe(false);
    await expect(inviteUser(admin, ids.client, "boss@sec.test", "owner_admin")).rejects.toBeInstanceOf(AdminError);
    await expect(inviteUser(admin, ids.client, "boss@sec.test", "coach")).rejects.toBeInstanceOf(AdminError);
    await expect(inviteUser(admin, ids.org, "someone@sec.test", "client")).rejects.toBeInstanceOf(AdminError);
    expect((await inviteUser(admin, ids.client, "new-client@sec.test", "client"))?.status).toBe("invited");
    expect((await inviteUser(admin, ids.org, "new-coach@sec.test", "coach"))?.status).toBe("invited");
  });
  it("assigns only real coaches", async () => {
    if (!ok) return expect(ok).toBe(false);
    await expect(assignCoach(admin, ids.client, ids.clientUser)).rejects.toBeInstanceOf(AdminError);
    await expect(assignCoach(admin, ids.client, ids.admin2)).rejects.toBeInstanceOf(AdminError);
  });
  it("turns access off and on, audited in the same step, and never for yourself", async () => {
    if (!ok) return expect(ok).toBe(false);
    await expect(setMemberAccess(admin, ids.admin, false)).rejects.toBeInstanceOf(AdminError);
    await setMemberAccess(admin, ids.clientUser, false);
    const status = async () => (await withTenantSession(ADMIN_DB, (c) => c.query<{ status: string }>("SELECT status FROM users WHERE id = $1", [ids.clientUser]))).rows[0].status;
    expect(await status()).toBe("disabled");
    // Never signed in, so turning access back on makes the invite pending again.
    await setMemberAccess(admin, ids.clientUser, true);
    expect(await status()).toBe("invited");
    const audit = await withTenantSession(ADMIN_DB, (c) =>
      c.query<{ action: string }>("SELECT action FROM admin_audit_log WHERE tenant_id = $1 ORDER BY created_at", [ids.client]),
    );
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["user.disable", "user.enable"]));
  });
  it("switches coach and admin only inside the organisation, never your own role", async () => {
    if (!ok) return expect(ok).toBe(false);
    await expect(setMemberRole(admin, ids.admin, "coach")).rejects.toBeInstanceOf(AdminError);
    await expect(setMemberRole(admin, ids.clientUser, "owner_admin")).rejects.toBeInstanceOf(AdminError);
    await setMemberRole(admin, ids.admin2, "coach");
    await setMemberRole(admin, ids.admin2, "owner_admin");
  });
  it("won't archive the admins' own organisation", async () => {
    if (!ok) return expect(ok).toBe(false);
    await expect(setWorkspaceStatus(admin, ids.org, "archived")).rejects.toBeInstanceOf(AdminError);
  });
  it("a hard cap of 0 switches drafting off", async () => {
    if (!ok) return expect(ok).toBe(false);
    const scope = { tenantId: ids.other, userId: null, isPlatformAdmin: false };
    await enforceCap(scope, "text");
    await setUsageCaps(admin, ids.other, { textSoft: null, textHard: 0, imageSoft: null, imageHard: null });
    await expect(enforceCap(scope, "text")).rejects.toBeInstanceOf(UsageCapError);
    await setUsageCaps(admin, ids.other, { textSoft: null, textHard: null, imageSoft: null, imageHard: null });
    await enforceCap(scope, "text");
  });
});
