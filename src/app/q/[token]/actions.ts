"use server";

import { redirect } from "next/navigation";
import { withTenantSession } from "@/db/session";
import { verifyQuestionnaireToken } from "@/lib/invite/token";

/**
 * Public questionnaire submission. The token authorises writing ONLY the named
 * tenant's DRAFT brand profile; the write runs in that tenant's RLS scope so it
 * cannot touch any other workspace (INV-1). No auth session required — the
 * workshop itself is the onboarding (brief §4.1).
 */
export async function submitQuestionnaire(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const tenantId = verifyQuestionnaireToken(token);
  if (!tenantId) throw new Error("invalid or expired questionnaire link");

  const g = (k: string) => String(formData.get(k) ?? "").trim();
  const storyArc = [
    { chapter: 1, title: "Origin", body: g("story1") },
    { chapter: 2, title: "Turning point", body: g("story2") },
    { chapter: 3, title: "Now", body: g("story3") },
  ];
  const samplePosts = g("samples").split("\n").map((s) => s.trim()).filter(Boolean);

  await withTenantSession(
    { tenantId, userId: null, isPlatformAdmin: false },
    async (c) => {
      // Answers land in a "Pre-workshop brief" project (created once, reused on re-submit).
      const projectId =
        (await c.query("SELECT id FROM projects WHERE name='Pre-workshop brief' AND status='active' ORDER BY created_at LIMIT 1")).rows[0]?.id ??
        (await c.query("INSERT INTO projects (tenant_id, name) VALUES ($1,'Pre-workshop brief') RETURNING id", [tenantId])).rows[0].id;
      // Upsert a single DRAFT profile per project so re-submits update, not pile up.
      const existing = (
        await c.query("SELECT id FROM brand_profiles WHERE project_id=$1 AND status='draft' ORDER BY updated_at DESC LIMIT 1", [projectId])
      ).rows[0];
      const audience = g("audience") ? { description: g("audience") } : {};
      if (existing) {
        await c.query(
          `UPDATE brand_profiles SET niche=$1, positioning_statement=$2, audience=$3, story_arc=$4 WHERE id=$5`,
          [g("niche"), g("positioning"), JSON.stringify(audience), JSON.stringify(storyArc), existing.id],
        );
      } else {
        await c.query(
          `INSERT INTO brand_profiles (tenant_id, project_id, status, niche, positioning_statement, audience, story_arc)
           VALUES ($1,$6,'draft',$2,$3,$4,$5) RETURNING id`,
          [tenantId, g("niche"), g("positioning"), JSON.stringify(audience), JSON.stringify(storyArc), projectId],
        );
      }
      const bp = (
        await c.query("SELECT id FROM brand_profiles WHERE project_id=$1 AND status='draft' ORDER BY updated_at DESC LIMIT 1", [projectId])
      ).rows[0];
      if (samplePosts.length) {
        const vg = (await c.query("SELECT id FROM voice_guides WHERE brand_profile_id=$1", [bp.id])).rows[0];
        if (vg) {
          await c.query("UPDATE voice_guides SET sample_posts=$1 WHERE id=$2", [JSON.stringify(samplePosts), vg.id]);
        } else {
          await c.query(
            "INSERT INTO voice_guides (tenant_id, brand_profile_id, sample_posts) VALUES ($1,$2,$3)",
            [tenantId, bp.id, JSON.stringify(samplePosts)],
          );
        }
      }
    },
  );

  redirect(`/q/${token}?done=1`);
}
