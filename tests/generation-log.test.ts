/**
 * "Every model call writes a `generation_logs` row before returning. No silent
 * failures." — AGENTS.md §3, brief §05. That invariant had no test: the audit
 * trail the usage meter, the monthly caps and the handover all read from was
 * taken on trust.
 *
 * It also pins the per-call `context_version` (INV-2). `prompt_version` says
 * which TEMPLATE wrote a piece; `context_version` says which shape of context
 * block was injected. The context builder's docstring claimed the second was
 * recorded long before anything wrote it, so a bad output could not in fact
 * be traced back to the context that produced it.
 *
 * Skips locally without a database; in CI an unreachable database fails.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withTenantSession } from "@/db/session";
import { appPool } from "@/db/pool";
import { generateText, generateImage } from "@/lib/ai";
import { buildBrandContext, CONTEXT_VERSION } from "@/lib/context/context-builder";
import { noteDbUnreachable } from "./helpers/require-db";

const ADMIN = { tenantId: null, userId: null, isPlatformAdmin: true } as const;

let dbReachable = false;
let tenantId = "";
let userId = "";

const context = buildBrandContext({ brandProfile: { niche: "Leadership coaching", audience: { who: "New managers" } } });

/** Rows this call wrote, newest first. */
async function logsFor(scope: { tenantId: string; userId: string; isPlatformAdmin: boolean }) {
  return withTenantSession(scope, async (c) =>
    (
      await c.query<{ kind: string; status: string; model: string; context_version: number | null }>(
        "SELECT kind, status, model, context_version FROM generation_logs ORDER BY created_at DESC, id",
      )
    ).rows,
  );
}

beforeAll(async () => {
  try {
    tenantId = await withTenantSession(ADMIN, async (c) =>
      (await c.query<{ id: string }>("INSERT INTO tenants (name) VALUES ($1) RETURNING id", ["Generation log test"])).rows[0].id);
    userId = await withTenantSession(ADMIN, async (c) =>
      (
        await c.query<{ id: string }>(
          "INSERT INTO users (tenant_id, email, role, status) VALUES ($1,$2,'client','active') RETURNING id",
          [tenantId, `genlog-${Date.now()}@test.local`],
        )
      ).rows[0].id);
    dbReachable = true;
  } catch (err) {
    dbReachable = noteDbUnreachable(err);
  }
});

afterAll(async () => {
  if (tenantId) await withTenantSession(ADMIN, (c) => c.query("DELETE FROM tenants WHERE id=$1", [tenantId]));
  await appPool().end().catch(() => {});
});

describe("generation_logs is written for every model call", () => {
  it("logs a successful text call, with the context version that produced it", async () => {
    if (!dbReachable) return;
    const scope = { tenantId, userId, isPlatformAdmin: false };
    await generateText(scope, { context, templateKey: "linkedin_post", systemTemplate: "Write a post.", taskInput: "Topic: hiring" });

    const rows = await logsFor(scope);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "text", status: "ok" });
    expect(rows[0].context_version).toBe(CONTEXT_VERSION);
  });

  it("logs an image call too", async () => {
    if (!dbReachable) return;
    const scope = { tenantId, userId, isPlatformAdmin: false };
    const before = (await logsFor(scope)).length;
    await generateImage(scope, { context, prompt: "A desk at dawn" });

    const rows = await logsFor(scope);
    expect(rows).toHaveLength(before + 1);
    expect(rows[0]).toMatchObject({ kind: "image", status: "ok" });
    expect(rows[0].context_version).toBe(CONTEXT_VERSION);
  });

  // The failure path is the one that matters: a call that throws must still
  // leave a trace, or a broken provider looks like no usage at all.
  it("logs a failed call rather than letting it disappear", async () => {
    if (!dbReachable) return;
    const scope = { tenantId, userId, isPlatformAdmin: false };
    const before = (await logsFor(scope)).length;

    // A cap of zero refuses the next call, which is a real failure path
    // reached without reaching for a provider that does not exist.
    await withTenantSession(ADMIN, (c) =>
      c.query(
        "INSERT INTO tenant_usage_caps (tenant_id, monthly_text_hard) VALUES ($1, 1) ON CONFLICT (tenant_id) DO UPDATE SET monthly_text_hard = 1",
        [tenantId],
      ));
    await expect(
      generateText(scope, { context, templateKey: "linkedin_post", systemTemplate: "Write a post.", taskInput: "Topic: hiring" }),
    ).rejects.toThrow();

    const rows = await logsFor(scope);
    expect(rows).toHaveLength(before + 1);
    expect(rows[0].status).toBe("error");
  });
});
