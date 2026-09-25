/**
 * DB-backed loader for the brand context object (INV-2). Loads the active brand
 * profile + the OWNER'S VOICE PACK + the visual identity for a scope and
 * composes them through the ONE versioned builder. Feature code that needs
 * context calls this — it never queries the tables and assembles context itself.
 *
 * The voice comes from the person's pack (client spec v2). The brand's old
 * voice_guide is read only where a pack does not exist yet, so nothing breaks
 * for a workspace that has not been through the new intake.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession } from "@/db/session";
import type { WorkspaceScope } from "@/lib/data/projects";
import { fewShotSamples, loadPackForWorkspace } from "@/lib/data/voice-pack";
import { packToContextInput } from "@/lib/voice/context";
import { buildBrandContext, type BrandContext, type VoicePackInput } from "./context-builder";

export async function loadBrandContext(
  scope: WorkspaceScope,
  language = "en",
  /** The platform being written for, so the right context block is loaded. */
  channel?: string,
): Promise<BrandContext> {
  // Loaded outside the query below so the pack's own access rules run once.
  const pack = await loadPackForWorkspace(scope);
  let voicePack: VoicePackInput | null = null;
  if (pack) {
    const samples = await fewShotSamples(scope, pack.id, channel);
    voicePack = packToContextInput(pack, samples, channel);
  }

  return withTenantSession(scope, async (c) => {
    const bp = (
      await c.query(
        `SELECT * FROM brand_profiles WHERE project_id IS NULL
          ORDER BY status = 'active' DESC, updated_at DESC LIMIT 1`,
      )
    ).rows[0];

    if (!bp) return buildBrandContext({ language, voicePack });

    const vg = (
      await c.query(`SELECT * FROM voice_guides WHERE brand_profile_id = $1 LIMIT 1`, [bp.id])
    ).rows[0];
    const vi = (
      await c.query(`SELECT * FROM visual_identities WHERE brand_profile_id = $1 LIMIT 1`, [bp.id])
    ).rows[0];

    return buildBrandContext({
      language,
      voicePack,
      brandProfile: {
        storyArc: bp.story_arc ?? [],
        positioningStatement: bp.positioning_statement,
        niche: bp.niche,
        audience: bp.audience,
        offersSummary: bp.offers_summary,
      },
      // Fallback only: ignored by the builder when a pack is present.
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
