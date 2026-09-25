/**
 * Seed data (brief §06 wk3, DoD §11). Idempotent-ish: skips if the owner org
 * already exists. Creates:
 *   - the owner org (The Brand Professor) + an admin user
 *   - a demo client workspace with a full brand foundation + pillars
 *   - global prompt templates
 *
 * Prints seeded user identities so the dev login page can establish a session.
 * Run with: npm run db:seed
 */
import "dotenv/config";
import { withTenantSession } from "@/db/session";

async function main() {
  const admin = { tenantId: null, userId: null, isPlatformAdmin: true } as const;

  const existing = await withTenantSession(admin, (c) =>
    c.query("SELECT id FROM tenants WHERE name = 'The Brand Professor'"),
  );
  if ((existing.rowCount ?? 0) > 0) {
    console.log("• seed skipped — owner org already exists");
    return;
  }

  // Owner org + admin user.
  const ownerTenant = (
    await withTenantSession(admin, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO tenants (name, branding) VALUES ($1, $2) RETURNING id",
        ["The Brand Professor", JSON.stringify({ theme: "house" })],
      ),
    )
  ).rows[0].id;

  const adminUser = (
    await withTenantSession(admin, (c) =>
      c.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, role, status)
         VALUES ($1, $2, 'owner_admin', 'active') RETURNING id`,
        [ownerTenant, "admin@huemen.studio"],
      ),
    )
  ).rows[0].id;

  // Demo client workspace.
  const clientTenant = (
    await withTenantSession(admin, (c) =>
      c.query<{ id: string }>(
        "INSERT INTO tenants (name) VALUES ('Demo Client') RETURNING id",
      ),
    )
  ).rows[0].id;

  const clientUser = (
    await withTenantSession(admin, (c) =>
      c.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, role, status)
         VALUES ($1, 'demo@client.test', 'client', 'active') RETURNING id`,
        [clientTenant],
      ),
    )
  ).rows[0].id;

  // Full brand foundation for the demo client, inside its first project.
  await withTenantSession(
    { tenantId: clientTenant, userId: clientUser, isPlatformAdmin: false },
    async (c) => {
      const projectId = (
        await c.query<{ id: string }>(
          "INSERT INTO projects (tenant_id, name, stage, created_by) VALUES ($1, 'Personal brand', 'content', $2) RETURNING id",
          [clientTenant, clientUser],
        )
      ).rows[0].id;
      const bp = (
        await c.query<{ id: string }>(
          `INSERT INTO brand_profiles
             (tenant_id, project_id, status, story_arc, positioning_statement, niche, audience, offers_summary, completeness)
           VALUES ($1,$7,'active',$2,$3,$4,$5,$6,100) RETURNING id`,
          [
            clientTenant,
            JSON.stringify([
              { chapter: 1, title: "Origin", body: "Left agency life to help founders." },
              { chapter: 2, title: "Struggle", body: "Learned brand is a system, not a logo." },
              { chapter: 3, title: "Now", body: "Packages expert authority into offers." },
            ]),
            "The brand professor for solo B2B experts.",
            "Personal branding for B2B founders",
            JSON.stringify({ role: "founders", stage: "post-PMF" }),
            "1:1 coaching and cohort workshops.",
            projectId,
          ],
        )
      ).rows[0].id;

      await c.query(
        `INSERT INTO voice_guides
           (tenant_id, brand_profile_id, tone_descriptors, do_words, dont_words, sample_posts, reading_level)
         VALUES ($1,$2,$3,$4,$5,$6,'grade 8')`,
        [
          clientTenant,
          bp,
          JSON.stringify(["direct", "warm", "contrarian"]),
          ["clarity", "authority", "system"],
          ["synergy", "leverage", "guru"],
          JSON.stringify(["Sample post one.", "Sample post two.", "Sample post three."]),
        ],
      );

      await c.query(
        `INSERT INTO visual_identities
           (tenant_id, brand_profile_id, palette, fonts, image_style_notes, aspect_ratio_defaults)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          clientTenant,
          bp,
          JSON.stringify(["#000000", "#FFFFFF", "#F4F4F4"]),
          JSON.stringify(["Borna", "Times"]),
          "Editorial, high-contrast, generous whitespace.",
          JSON.stringify({ linkedin: "1200x1200", instagram: "1080x1350" }),
        ],
      );

      for (const [i, name] of ["Authority", "Systems", "Contrarian takes"].entries()) {
        await c.query(
          `INSERT INTO pillars (tenant_id, project_id, brand_profile_id, name, sort_order) VALUES ($1,$5,$2,$3,$4)`,
          [clientTenant, bp, name, i, projectId],
        );
      }

      // Two drafted posts so the Content step + brand check render: one clean,
      // one deliberately off-brand (superlatives, exclamation, don't-words).
      const posts: [string, string, string][] = [
        [
          "Most founder brands sound the same because they were written by someone describing a founder, not by the founder.",
          "You do not need a louder voice. You need a truer one — the one that already shows up when you stop performing for the algorithm.",
          "approved",
        ],
        [
          "We are thrilled to announce a game-changing new offering that will revolutionise how you leverage synergy!",
          "It is believed by many that this can be optimised. Three superlatives in one sentence is the kind of line the brand check flags against your own writing.",
          "draft",
        ],
      ];
      for (const [hook, body, status] of posts) {
        await c.query(
          `INSERT INTO content_items (tenant_id, project_id, channel, format, hook, body, cta, status, created_by)
           VALUES ($1,$2,'linkedin','linkedin_post',$3,$4,'',$5,$6)`,
          [clientTenant, projectId, hook, body, status, clientUser],
        );
      }
    },
  );

  // A measured voice pack so the on-brand check (§15.3/§15.4) has rules to flag
  // against — otherwise every draft scores 100 with nothing to learn from.
  await withTenantSession(
    { tenantId: clientTenant, userId: clientUser, isPlatformAdmin: false },
    (c) =>
      c.query(
        `INSERT INTO voice_packs (tenant_id, user_id, slug, display_name, status, voice_index, corpus_stats, identity)
         VALUES ($1,$2,'default',$3,'active',$4,$5,$6)
         ON CONFLICT (tenant_id, user_id, slug)
         DO UPDATE SET voice_index = EXCLUDED.voice_index, corpus_stats = EXCLUDED.corpus_stats, identity = EXCLUDED.identity, status = 'active'`,
        [
          clientTenant,
          clientUser,
          "Alex Rivera",
          JSON.stringify({ neverWords: ["synergy", "leverage", "guru", "game-changing", "revolutionise"] }),
          JSON.stringify({ pieces: 12, words: 3400, channels: ["linkedin"] }),
          JSON.stringify({ toneDescriptors: { value: ["Direct", "Warm", "Contrarian", "Evidence-led"], source: "ask", confidence: "inferred" } }),
        ],
      ),
  );

  // Global prompt templates (tenant_id NULL).
  await withTenantSession(admin, async (c) => {
    const templates: [string, string][] = [
      ["linkedin_post", "You write on-brand LinkedIn posts. Obey the brand voice and guardrails."],
      ["linkedin_hook_set", "You write 5 scroll-stopping LinkedIn hooks. Vary the angle."],
      ["ig_caption", "You write Instagram captions that match the brand voice."],
      ["image_brief", "You turn a post into a brand-aware image brief."],
    ];
    for (const [key, body] of templates) {
      await c.query(
        `INSERT INTO prompt_templates (tenant_id, key, version, body, created_by)
         VALUES (NULL, $1, 1, $2, $3)`,
        [key, body, adminUser],
      );
    }
  });

  console.log("✓ seed complete");
  console.log(
    JSON.stringify(
      {
        adminLogin: { userId: adminUser, tenantId: ownerTenant, role: "owner_admin", email: "admin@huemen.studio" },
        clientLogin: { userId: clientUser, tenantId: clientTenant, role: "client", email: "demo@client.test" },
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
