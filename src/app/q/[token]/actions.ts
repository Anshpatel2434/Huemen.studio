"use server";

import { redirect } from "next/navigation";
import { withTenantSession } from "@/db/session";
import { verifyQuestionnaireToken } from "@/lib/invite/token";

/**
 * Public questionnaire submission. The token authorises writing ONLY the named
 * tenant's brand foundation; the write runs in that tenant's RLS scope so it
 * cannot touch any other workspace (INV-1). No auth session required — the
 * workshop itself is the onboarding (brief §4.1).
 *
 * Answers land on the WORKSPACE brief (`project_id IS NULL`, migration 0007),
 * which is the one the studio, onboarding pre-fill and every prompt read.
 * They fill what is empty and never overwrite what the person or their coach
 * has already written: a questionnaire is a first draft, not the last word.
 */
export async function submitQuestionnaire(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const tenantId = verifyQuestionnaireToken(token);
  if (!tenantId) throw new Error("invalid or expired questionnaire link");

  const g = (k: string) => String(formData.get(k) ?? "").trim();
  const answers = {
    niche: g("niche"),
    positioning: g("positioning"),
    audience: g("audience"),
    chapters: [
      { chapter: 1, title: "Origin", body: g("story1") },
      { chapter: 2, title: "Turning point", body: g("story2") },
      { chapter: 3, title: "Now", body: g("story3") },
    ],
    samplePosts: g("samples").split("\n").map((s) => s.trim()).filter(Boolean),
  };

  await withTenantSession({ tenantId, userId: null, isPlatformAdmin: false }, async (c) => {
    const bp = (
      await c.query(`SELECT * FROM brand_profiles WHERE project_id IS NULL ORDER BY status='active' DESC, updated_at DESC LIMIT 1`)
    ).rows[0];

    const keep = (current: unknown, next: string) => (typeof current === "string" && current.trim() ? current : next || null);
    const existingArc = ((bp?.story_arc ?? []) as { chapter?: number; title?: string; body?: string }[]);
    const storyArc = answers.chapters.map((ch, i) => {
      const cur = existingArc[i];
      return cur?.body?.trim() ? cur : { chapter: ch.chapter, title: cur?.title?.trim() || ch.title, body: ch.body };
    });
    const existingAudience = (bp?.audience ?? {}) as Record<string, unknown>;
    const audience =
      Object.keys(existingAudience).length > 0 ? existingAudience : answers.audience ? { description: answers.audience } : {};

    let profileId: string;
    if (bp) {
      profileId = bp.id;
      await c.query(`UPDATE brand_profiles SET niche=$1, positioning_statement=$2, audience=$3, story_arc=$4 WHERE id=$5`, [
        keep(bp.niche, answers.niche),
        keep(bp.positioning_statement, answers.positioning),
        JSON.stringify(audience),
        JSON.stringify(storyArc),
        bp.id,
      ]);
    } else {
      profileId = (
        await c.query<{ id: string }>(
          `INSERT INTO brand_profiles (tenant_id, project_id, status, niche, positioning_statement, audience, story_arc)
           VALUES ($1,NULL,'draft',$2,$3,$4,$5) RETURNING id`,
          [tenantId, answers.niche || null, answers.positioning || null, JSON.stringify(audience), JSON.stringify(storyArc)],
        )
      ).rows[0].id;
    }

    if (answers.samplePosts.length) {
      const vg = (await c.query("SELECT id, sample_posts FROM voice_guides WHERE brand_profile_id=$1", [profileId])).rows[0];
      const current: string[] = Array.isArray(vg?.sample_posts) ? vg.sample_posts : [];
      // Add what is new; a re-submit never duplicates a post.
      const merged = [...current, ...answers.samplePosts.filter((p) => !current.includes(p))];
      if (vg) await c.query("UPDATE voice_guides SET sample_posts=$1 WHERE id=$2", [JSON.stringify(merged), vg.id]);
      else
        await c.query("INSERT INTO voice_guides (tenant_id, brand_profile_id, sample_posts) VALUES ($1,$2,$3)", [
          tenantId,
          profileId,
          JSON.stringify(merged),
        ]);
    }
  });

  redirect(`/q/${token}?done=1`);
}
