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
import { buildBrandContext, type BrandContext, type ContextTask, type PlatformInput, type VoicePackInput } from "./context-builder";
import { platformLines, platformRule } from "@/lib/voice/platforms";
import { visualCoreLines } from "@/lib/visual/core";

export async function loadBrandContext(
  scope: WorkspaceScope,
  language = "en",
  /** The platform being written for, so the right context block is loaded. */
  channel?: string,
  /** What the context is for: decides which parts of the voice load (spec 01 §3). */
  task: ContextTask = "write",
): Promise<BrandContext> {
  // Loaded outside the query below so the pack's own access rules run once.
  const pack = await loadPackForWorkspace(scope);
  let voicePack: VoicePackInput | null = null;
  if (pack) {
    // A check and a short reply don't load samples (01 §3), so don't fetch them.
    const samples = task === "write" || task === "rewrite" ? await fewShotSamples(scope, pack.id, channel) : [];
    voicePack = packToContextInput(pack, samples, channel);
  }

  const rule = platformRule(channel);
  const platform: PlatformInput | null = rule ? { label: rule.label, lines: platformLines(rule) } : null;

  return withTenantSession(scope, async (c) => {
    const bp = (
      await c.query(
        `SELECT * FROM brand_profiles WHERE project_id IS NULL
          ORDER BY status = 'active' DESC, updated_at DESC LIMIT 1`,
      )
    ).rows[0];

    if (!bp) return buildBrandContext({ language, voicePack, platform, task });

    const vg = (
      await c.query(`SELECT * FROM voice_guides WHERE brand_profile_id = $1 LIMIT 1`, [bp.id])
    ).rows[0];
    const vi = (
      await c.query(`SELECT * FROM visual_identities WHERE brand_profile_id = $1 LIMIT 1`, [bp.id])
    ).rows[0];
    // The offer designer's offers (§4.4) are workspace-level, like the brief.
    const offers = (
      await c.query<{ name: string; format: string | null; promise: string | null }>(
        `SELECT name, format, promise FROM offers WHERE project_id IS NULL ORDER BY created_at LIMIT 8`,
      )
    ).rows;

    // Pillars and strategy answers are brand data, so they ride in the block
    // too; no module appends them to its own task input (INV-2).
    const pillars = (
      await c.query<{ name: string; description: string | null }>(
        `SELECT name, description FROM pillars WHERE project_id IS NULL ORDER BY sort_order, created_at LIMIT 8`,
      )
    ).rows;
    const strategyAnswers = ((bp.brief_answers ?? []) as { key: string; answer: string }[]).filter((a) => a?.answer?.trim());

    return buildBrandContext({
      language,
      voicePack,
      platform,
      task,
      brandProfile: {
        storyArc: bp.story_arc ?? [],
        positioningStatement: bp.positioning_statement,
        niche: bp.niche,
        audience: bp.audience,
        offersSummary: bp.offers_summary,
        offers,
        pillars,
        strategyAnswers,
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
        coreLines: visualCoreLines(vi.core),
        aspectRatioDefaults: vi.aspect_ratio_defaults,
      },
    });
  });
}
