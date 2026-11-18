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
import { fewShotSamplesCounted, loadPackForWorkspace } from "@/lib/data/voice-pack";
import { packCaps, packToContextInput } from "@/lib/voice/context";
import { buildBrandContext, type BrandContext, type ContextCap, type ContextTask, type PlatformInput, type VoicePackInput } from "./context-builder";
import { platformLines, platformRule } from "@/lib/voice/platforms";
import { visualCoreLines } from "@/lib/visual/core";

/** How many offers and pillars the block carries (H2: the cap is recorded when it bites). */
const OFFERS_MAX = 12;
const PILLARS_MAX = 12;

export async function loadBrandContext(
  scope: WorkspaceScope,
  language = "en",
  /** The platform being written for, so the right context block is loaded. */
  channel?: string,
  /** What the context is for: decides which parts of the voice load (spec 01 §3). */
  task: ContextTask = "write",
  /**
   * withoutLook: leave the stored reading of their reference designs out. Only
   * for the call that reads the designs again: with the old reading in the
   * context the model copied it word for word (2026-11-18).
   */
  opts: { withoutLook?: boolean } = {},
): Promise<BrandContext> {
  // Loaded outside the query below so the pack's own access rules run once.
  const pack = await loadPackForWorkspace(scope);
  let voicePack: VoicePackInput | null = null;
  const caps: ContextCap[] = [];
  if (pack) {
    // A check and a short reply don't load samples (01 §3), so don't fetch them.
    let samples: Awaited<ReturnType<typeof fewShotSamplesCounted>>["samples"] = [];
    if (task === "write" || task === "rewrite") {
      const few = await fewShotSamplesCounted(scope, pack.id, channel);
      samples = few.samples;
      caps.push({ section: "Their real writing", shown: few.samples.length, total: few.total });
    }
    voicePack = packToContextInput(pack, samples, channel);
    caps.push(...packCaps(pack));
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

    if (!bp) return buildBrandContext({ language, voicePack, platform, task, caps });

    const vg = (
      await c.query(`SELECT * FROM voice_guides WHERE brand_profile_id = $1 LIMIT 1`, [bp.id])
    ).rows[0];
    const vi = (
      await c.query(`SELECT * FROM visual_identities WHERE brand_profile_id = $1 LIMIT 1`, [bp.id])
    ).rows[0];
    // The offer designer's offers (§4.4) are workspace-level, like the brief.
    // COUNT(*) OVER() is taken before the LIMIT, so a cut list says how many it hid.
    const offerRows = (
      await c.query<{ name: string; format: string | null; promise: string | null; deliverables: string[] | null; pricing: string | null; total: string }>(
        `SELECT name, format, promise, deliverables, pricing_logic_notes AS pricing, COUNT(*) OVER() AS total
           FROM offers WHERE project_id IS NULL ORDER BY created_at LIMIT ${OFFERS_MAX}`,
      )
    ).rows;
    const offers = offerRows.map((o) => ({
      name: o.name, format: o.format, promise: o.promise, pricing: o.pricing,
      deliverables: Array.isArray(o.deliverables) ? o.deliverables : [],
    }));
    caps.push({ section: "Offers", shown: offers.length, total: offerRows.length ? Number(offerRows[0].total) : 0 });

    // Pillars and strategy answers are brand data, so they ride in the block
    // too; no module appends them to its own task input (INV-2).
    const pillarRows = (
      await c.query<{ name: string; description: string | null; total: string }>(
        `SELECT name, description, COUNT(*) OVER() AS total FROM pillars WHERE project_id IS NULL
          ORDER BY sort_order, created_at LIMIT ${PILLARS_MAX}`,
      )
    ).rows;
    const pillars = pillarRows.map((p) => ({ name: p.name, description: p.description }));
    caps.push({ section: "Content pillars", shown: pillars.length, total: pillarRows.length ? Number(pillarRows[0].total) : 0 });
    const strategyAnswers = ((bp.brief_answers ?? []) as { key: string; answer: string }[]).filter((a) => a?.answer?.trim());

    return buildBrandContext({
      language,
      voicePack,
      platform,
      task,
      caps,
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
        coreLines: visualCoreLines(opts.withoutLook && vi.core ? { ...vi.core, look: undefined } : vi.core),
        aspectRatioDefaults: vi.aspect_ratio_defaults,
      },
    });
  });
}
