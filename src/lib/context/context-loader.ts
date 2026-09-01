/**
 * DB-backed loader for the brand context object (INV-2). Loads the active brand
 * profile + its voice guide + visual identity for a tenant scope and composes
 * them through the ONE versioned builder. Feature code that needs context calls
 * this — it never queries the three tables and assembles context itself.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession, type SessionScope } from "@/db/session";
import { buildBrandContext, type BrandContext } from "./context-builder";

export async function loadBrandContext(
  scope: SessionScope,
  language = "en",
): Promise<BrandContext> {
  return withTenantSession(scope, async (c) => {
    const bp = (
      await c.query(
        `SELECT * FROM brand_profiles ORDER BY status = 'active' DESC, updated_at DESC LIMIT 1`,
      )
    ).rows[0];

    if (!bp) return buildBrandContext({ language });

    const vg = (
      await c.query(`SELECT * FROM voice_guides WHERE brand_profile_id = $1 LIMIT 1`, [bp.id])
    ).rows[0];
    const vi = (
      await c.query(`SELECT * FROM visual_identities WHERE brand_profile_id = $1 LIMIT 1`, [bp.id])
    ).rows[0];

    return buildBrandContext({
      language,
      brandProfile: {
        storyArc: bp.story_arc ?? [],
        positioningStatement: bp.positioning_statement,
        niche: bp.niche,
        audience: bp.audience,
        offersSummary: bp.offers_summary,
      },
      voiceGuide: vg && {
        toneDescriptors: vg.tone_descriptors ?? [],
        doWords: vg.do_words ?? [],
        dontWords: vg.dont_words ?? [],
        samplePosts: vg.sample_posts ?? [],
        readingLevel: vg.reading_level,
        formattingRules: vg.formatting_rules,
      },
      visualIdentity: vi && {
        palette: vi.palette ?? [],
        fonts: vi.fonts ?? [],
        imageStyleNotes: vi.image_style_notes,
        aspectRatioDefaults: vi.aspect_ratio_defaults,
      },
    });
  });
}
