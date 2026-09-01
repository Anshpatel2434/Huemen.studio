/**
 * Brand Foundation data access (brief §4.1). Loads/saves the editable brand
 * profile + voice guide + visual identity for a tenant scope, and recomputes
 * completeness through the ONE versioned context builder (INV-2) on save so the
 * studio degradation signal (P1-10) stays truthful.
 *
 * Server-only.
 */
import "server-only";
import { withTenantSession, type SessionScope } from "@/db/session";
import { buildBrandContext } from "@/lib/context/context-builder";

export interface FoundationForm {
  niche: string;
  positioning: string;
  offers: string;
  audience: string;
  chapters: { title: string; body: string }[]; // exactly 3
  tone: string; // comma-separated
  doWords: string; // comma-separated
  dontWords: string; // comma-separated
  readingLevel: string;
  samplePosts: string; // one per line
  palette: string; // comma-separated hex
  fonts: string; // comma-separated
  imageStyleNotes: string;
}

const EMPTY: FoundationForm = {
  niche: "",
  positioning: "",
  offers: "",
  audience: "",
  chapters: [
    { title: "", body: "" },
    { title: "", body: "" },
    { title: "", body: "" },
  ],
  tone: "",
  doWords: "",
  dontWords: "",
  readingLevel: "",
  samplePosts: "",
  palette: "",
  fonts: "",
  imageStyleNotes: "",
};

const csv = (s: string): string[] =>
  s.split(",").map((x) => x.trim()).filter(Boolean);
const lines = (s: string): string[] =>
  s.split("\n").map((x) => x.trim()).filter(Boolean);

export async function loadFoundation(scope: SessionScope): Promise<FoundationForm> {
  return withTenantSession(scope, async (c) => {
    const bp = (
      await c.query(
        `SELECT * FROM brand_profiles ORDER BY status='active' DESC, updated_at DESC LIMIT 1`,
      )
    ).rows[0];
    if (!bp) return EMPTY;

    const vg = (
      await c.query(`SELECT * FROM voice_guides WHERE brand_profile_id=$1 LIMIT 1`, [bp.id])
    ).rows[0];
    const vi = (
      await c.query(`SELECT * FROM visual_identities WHERE brand_profile_id=$1 LIMIT 1`, [bp.id])
    ).rows[0];

    const arc = (bp.story_arc ?? []) as { title?: string; body?: string }[];
    const chapters = [0, 1, 2].map((i) => ({
      title: arc[i]?.title ?? "",
      body: arc[i]?.body ?? "",
    }));

    return {
      niche: bp.niche ?? "",
      positioning: bp.positioning_statement ?? "",
      offers: bp.offers_summary ?? "",
      audience: (bp.audience?.description as string) ?? "",
      chapters,
      tone: (vg?.tone_descriptors ?? []).join(", "),
      doWords: (vg?.do_words ?? []).join(", "),
      dontWords: (vg?.dont_words ?? []).join(", "),
      readingLevel: vg?.reading_level ?? "",
      samplePosts: (vg?.sample_posts ?? []).join("\n"),
      palette: (vi?.palette ?? []).join(", "),
      fonts: (vi?.fonts ?? []).join(", "),
      imageStyleNotes: vi?.image_style_notes ?? "",
    };
  });
}

export async function saveFoundation(
  scope: SessionScope,
  form: FoundationForm,
): Promise<number> {
  const storyArc = form.chapters.map((ch, i) => ({
    chapter: i + 1,
    title: ch.title,
    body: ch.body,
  }));
  const audience = form.audience ? { description: form.audience } : {};

  // Recompute completeness via the single builder (INV-2).
  const ctx = buildBrandContext({
    brandProfile: {
      storyArc,
      positioningStatement: form.positioning,
      niche: form.niche,
      audience,
      offersSummary: form.offers,
    },
    voiceGuide: {
      toneDescriptors: csv(form.tone),
      doWords: csv(form.doWords),
      dontWords: csv(form.dontWords),
      samplePosts: lines(form.samplePosts),
      readingLevel: form.readingLevel,
    },
    visualIdentity: {
      palette: csv(form.palette),
      fonts: csv(form.fonts),
      imageStyleNotes: form.imageStyleNotes,
    },
  });

  return withTenantSession(scope, async (c) => {
    const tenantId = scope.tenantId!;
    const existing = (
      await c.query(
        `SELECT id FROM brand_profiles ORDER BY status='active' DESC, updated_at DESC LIMIT 1`,
      )
    ).rows[0];

    let profileId: string;
    if (existing) {
      profileId = existing.id;
      await c.query(
        `UPDATE brand_profiles SET niche=$1, positioning_statement=$2, offers_summary=$3,
           audience=$4, story_arc=$5, completeness=$6, status='active' WHERE id=$7`,
        [form.niche, form.positioning, form.offers, JSON.stringify(audience),
         JSON.stringify(storyArc), ctx.completeness, profileId],
      );
    } else {
      profileId = (
        await c.query(
          `INSERT INTO brand_profiles
             (tenant_id, status, niche, positioning_statement, offers_summary, audience, story_arc, completeness)
           VALUES ($1,'active',$2,$3,$4,$5,$6,$7) RETURNING id`,
          [tenantId, form.niche, form.positioning, form.offers,
           JSON.stringify(audience), JSON.stringify(storyArc), ctx.completeness],
        )
      ).rows[0].id;
    }

    // Voice guide upsert.
    const vgId = (
      await c.query(`SELECT id FROM voice_guides WHERE brand_profile_id=$1 LIMIT 1`, [profileId])
    ).rows[0]?.id;
    const vgVals = [
      JSON.stringify(csv(form.tone)), csv(form.doWords), csv(form.dontWords),
      JSON.stringify(lines(form.samplePosts)), form.readingLevel,
    ];
    if (vgId) {
      await c.query(
        `UPDATE voice_guides SET tone_descriptors=$1, do_words=$2, dont_words=$3,
           sample_posts=$4, reading_level=$5 WHERE id=$6`,
        [...vgVals, vgId],
      );
    } else {
      await c.query(
        `INSERT INTO voice_guides
           (tenant_id, brand_profile_id, tone_descriptors, do_words, dont_words, sample_posts, reading_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tenantId, profileId, ...vgVals],
      );
    }

    // Visual identity upsert.
    const viId = (
      await c.query(`SELECT id FROM visual_identities WHERE brand_profile_id=$1 LIMIT 1`, [profileId])
    ).rows[0]?.id;
    const viVals = [JSON.stringify(csv(form.palette)), JSON.stringify(csv(form.fonts)), form.imageStyleNotes];
    if (viId) {
      await c.query(
        `UPDATE visual_identities SET palette=$1, fonts=$2, image_style_notes=$3 WHERE id=$4`,
        [...viVals, viId],
      );
    } else {
      await c.query(
        `INSERT INTO visual_identities
           (tenant_id, brand_profile_id, palette, fonts, image_style_notes)
         VALUES ($1,$2,$3,$4,$5)`,
        [tenantId, profileId, ...viVals],
      );
    }

    return ctx.completeness;
  });
}
