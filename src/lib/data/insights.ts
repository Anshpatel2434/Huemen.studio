/**
 * Usage (brief §4.6 — reads generation_logs) and the pre-export brand health
 * review (the Relume "site health" step, re-cut for a personal brand: built only
 * from checks the brief already defines — completeness §4.1, voice guardrails
 * §4.2, pillar tagging §03).
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession, type SessionScope } from "@/db/session";
import type { BrandContext } from "@/lib/context/context-builder";
import type { ContentItemView } from "./content";
import type { PillarView } from "./planning";

export interface UsageView {
  textThisMonth: number;
  imagesThisMonth: number;
  errorsThisMonth: number;
  lastActivity: string | null;
  activeUsers: number;
  daily: { day: string; n: number }[];
  caps: { textSoft: number | null; textHard: number | null; imageSoft: number | null; imageHard: number | null };
  recent: { kind: string; model: string | null; status: string; latencyMs: number | null; at: string }[];
}

export async function loadUsage(scope: SessionScope): Promise<UsageView> {
  return withTenantSession(scope, async (c) => {
    const m = (
      await c.query(
        `SELECT count(*) FILTER (WHERE kind='text' AND status='ok')::int AS text,
                coalesce(sum(image_count) FILTER (WHERE kind='image' AND status='ok'),0)::int AS images,
                count(*) FILTER (WHERE status<>'ok')::int AS errors,
                count(DISTINCT user_id)::int AS users
           FROM generation_logs WHERE created_at >= date_trunc('month', now())`,
      )
    ).rows[0];
    const last = (await c.query("SELECT max(created_at) AS at FROM generation_logs")).rows[0]?.at;
    const daily = (
      await c.query(
        `SELECT to_char(d, 'Mon DD') AS day, coalesce(n, 0)::int AS n
           FROM generate_series(current_date - 13, current_date, '1 day') d
           LEFT JOIN (SELECT created_at::date AS day, count(*) AS n FROM generation_logs GROUP BY 1) g ON g.day = d
          ORDER BY d`,
      )
    ).rows;
    const caps = (await c.query("SELECT * FROM tenant_usage_caps LIMIT 1")).rows[0];
    const recent = (
      await c.query(
        "SELECT kind, model, status, latency_ms, created_at FROM generation_logs ORDER BY created_at DESC LIMIT 8",
      )
    ).rows;
    return {
      textThisMonth: m.text,
      imagesThisMonth: m.images,
      errorsThisMonth: m.errors,
      activeUsers: m.users,
      lastActivity: last ? new Date(last).toISOString() : null,
      daily,
      caps: {
        textSoft: caps?.monthly_text_soft ?? null,
        textHard: caps?.monthly_text_hard ?? null,
        imageSoft: caps?.monthly_image_soft ?? null,
        imageHard: caps?.monthly_image_hard ?? null,
      },
      recent: recent.map((r) => ({
        kind: r.kind,
        model: r.model,
        status: r.status,
        latencyMs: r.latency_ms,
        at: new Date(r.created_at).toISOString(),
      })),
    };
  });
}

export interface HealthCheck {
  key: string;
  label: string;
  ok: boolean;
  value: string;
  detail?: string;
}

export function brandHealth(ctx: BrandContext, content: ContentItemView[], pillars: PillarView[]) {
  const flagged = content.filter((c) => c.violations.length > 0);
  const missingCta = content.filter((c) => !c.cta.trim());
  const untagged = content.filter((c) => !c.pillarId);
  const approved = content.filter((c) => c.status === "approved");
  const checks: HealthCheck[] = [
    {
      key: "foundation",
      label: "Brand foundation",
      ok: !ctx.degraded,
      value: `${ctx.completeness}% complete`,
      detail: ctx.degraded ? ctx.warnings.slice(0, 2).join(" ") : undefined,
    },
    {
      key: "voice",
      label: "Voice guardrails",
      ok: flagged.length === 0,
      value: flagged.length ? `${flagged.length} flagged` : "No don't-words",
      detail: flagged.length ? `Don't-words found in ${flagged.length} piece${flagged.length > 1 ? "s" : ""}.` : undefined,
    },
    {
      key: "cta",
      label: "Calls to action",
      ok: missingCta.length === 0,
      value: missingCta.length ? `${missingCta.length} missing` : "All set",
    },
    {
      key: "pillars",
      label: "Pillar tagging",
      ok: pillars.length > 0 && untagged.length === 0,
      value: pillars.length === 0 ? "No pillars" : untagged.length ? `${untagged.length} untagged` : "All tagged",
    },
    {
      key: "approved",
      label: "Approved pieces",
      ok: approved.length > 0,
      value: `${approved.length} of ${content.length}`,
    },
  ];
  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  return { checks, score };
}
