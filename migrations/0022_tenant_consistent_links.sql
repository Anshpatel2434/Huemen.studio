-- =============================================================================
-- 0022_tenant_consistent_links — a row can only point at rows of its own
-- workspace, enforced by the database.
--
-- Found in the 2026-11-17 isolation test: content_items.pillar_id (and the
-- same column on ideas and calendar_entries) was a single-column foreign key.
-- A foreign-key check runs as the table owner and ignores RLS, so saving a
-- piece with ANOTHER workspace's pillar id was accepted, and when that other
-- workspace deleted its pillar, ON DELETE SET NULL changed this workspace's
-- row: one tenant's action modifying another tenant's data. The random-id
-- error versus the accepted real id also told a caller which ids exist.
--
-- Fix, as 0011 did for projects.pillar_id: every reference between two tenant
-- tables becomes (column, tenant_id) -> (id, tenant_id), so a row can only
-- point at a row with the same tenant_id. SET NULL clears the referencing
-- column only (Postgres 15+ column list), never tenant_id. References to
-- users stay single-column on purpose: a coach or admin of the organisation
-- legitimately creates rows inside a client workspace.
--
-- Rows written before this migration were checked: none point across
-- workspaces (the constraints below would refuse to be added if any did).
-- =============================================================================

-- Targets need a unique (id, tenant_id) to be referenced as a pair.
-- (pillars, projects, voice_packs and image_assets already have one.)
ALTER TABLE content_items   ADD CONSTRAINT content_items_id_tenant_key   UNIQUE (id, tenant_id);
ALTER TABLE ideas           ADD CONSTRAINT ideas_id_tenant_key           UNIQUE (id, tenant_id);
ALTER TABLE assets          ADD CONSTRAINT assets_id_tenant_key          UNIQUE (id, tenant_id);
ALTER TABLE brand_profiles  ADD CONSTRAINT brand_profiles_id_tenant_key  UNIQUE (id, tenant_id);

-- ---- pillars -----------------------------------------------------------------
ALTER TABLE content_items DROP CONSTRAINT content_items_pillar_id_fkey,
  ADD CONSTRAINT content_items_pillar_tenant_fkey FOREIGN KEY (pillar_id, tenant_id)
  REFERENCES pillars (id, tenant_id) ON DELETE SET NULL (pillar_id);
ALTER TABLE ideas DROP CONSTRAINT ideas_pillar_id_fkey,
  ADD CONSTRAINT ideas_pillar_tenant_fkey FOREIGN KEY (pillar_id, tenant_id)
  REFERENCES pillars (id, tenant_id) ON DELETE SET NULL (pillar_id);
ALTER TABLE calendar_entries DROP CONSTRAINT calendar_entries_pillar_id_fkey,
  ADD CONSTRAINT calendar_entries_pillar_tenant_fkey FOREIGN KEY (pillar_id, tenant_id)
  REFERENCES pillars (id, tenant_id) ON DELETE SET NULL (pillar_id);

-- ---- content items -----------------------------------------------------------
ALTER TABLE content_items DROP CONSTRAINT content_items_source_content_item_id_fkey,
  ADD CONSTRAINT content_items_source_tenant_fkey FOREIGN KEY (source_content_item_id, tenant_id)
  REFERENCES content_items (id, tenant_id) ON DELETE SET NULL (source_content_item_id);
ALTER TABLE content_generations DROP CONSTRAINT content_generations_content_item_id_fkey,
  ADD CONSTRAINT content_generations_item_tenant_fkey FOREIGN KEY (content_item_id, tenant_id)
  REFERENCES content_items (id, tenant_id) ON DELETE CASCADE;
ALTER TABLE image_assets DROP CONSTRAINT image_assets_content_item_id_fkey,
  ADD CONSTRAINT image_assets_item_tenant_fkey FOREIGN KEY (content_item_id, tenant_id)
  REFERENCES content_items (id, tenant_id) ON DELETE SET NULL (content_item_id);
ALTER TABLE ideas DROP CONSTRAINT ideas_converted_to_content_item_id_fkey,
  ADD CONSTRAINT ideas_converted_item_tenant_fkey FOREIGN KEY (converted_to_content_item_id, tenant_id)
  REFERENCES content_items (id, tenant_id) ON DELETE SET NULL (converted_to_content_item_id);
ALTER TABLE calendar_entries DROP CONSTRAINT calendar_entries_content_item_id_fkey,
  ADD CONSTRAINT calendar_entries_item_tenant_fkey FOREIGN KEY (content_item_id, tenant_id)
  REFERENCES content_items (id, tenant_id) ON DELETE SET NULL (content_item_id);
ALTER TABLE generation_logs DROP CONSTRAINT generation_logs_content_item_id_fkey,
  ADD CONSTRAINT generation_logs_item_tenant_fkey FOREIGN KEY (content_item_id, tenant_id)
  REFERENCES content_items (id, tenant_id) ON DELETE SET NULL (content_item_id);

-- ---- ideas, voice packs, assets ------------------------------------------------
ALTER TABLE projects DROP CONSTRAINT projects_idea_id_fkey,
  ADD CONSTRAINT projects_idea_tenant_fkey FOREIGN KEY (idea_id, tenant_id)
  REFERENCES ideas (id, tenant_id) ON DELETE SET NULL (idea_id);
ALTER TABLE brand_profiles DROP CONSTRAINT brand_profiles_voice_pack_id_fkey,
  ADD CONSTRAINT brand_profiles_voice_pack_tenant_fkey FOREIGN KEY (voice_pack_id, tenant_id)
  REFERENCES voice_packs (id, tenant_id) ON DELETE SET NULL (voice_pack_id);
ALTER TABLE visual_identities DROP CONSTRAINT visual_identities_logo_asset_id_fkey,
  ADD CONSTRAINT visual_identities_logo_tenant_fkey FOREIGN KEY (logo_asset_id, tenant_id)
  REFERENCES assets (id, tenant_id) ON DELETE SET NULL (logo_asset_id);

-- ---- brand profiles ------------------------------------------------------------
ALTER TABLE voice_guides DROP CONSTRAINT voice_guides_brand_profile_id_fkey,
  ADD CONSTRAINT voice_guides_profile_tenant_fkey FOREIGN KEY (brand_profile_id, tenant_id)
  REFERENCES brand_profiles (id, tenant_id) ON DELETE CASCADE;
ALTER TABLE visual_identities DROP CONSTRAINT visual_identities_brand_profile_id_fkey,
  ADD CONSTRAINT visual_identities_profile_tenant_fkey FOREIGN KEY (brand_profile_id, tenant_id)
  REFERENCES brand_profiles (id, tenant_id) ON DELETE CASCADE;
ALTER TABLE pillars DROP CONSTRAINT pillars_brand_profile_id_fkey,
  ADD CONSTRAINT pillars_profile_tenant_fkey FOREIGN KEY (brand_profile_id, tenant_id)
  REFERENCES brand_profiles (id, tenant_id) ON DELETE CASCADE;

-- ---- projects (a NULL project_id means workspace-level: not checked) --------------
ALTER TABLE brand_profiles DROP CONSTRAINT brand_profiles_project_id_fkey,
  ADD CONSTRAINT brand_profiles_project_tenant_fkey FOREIGN KEY (project_id, tenant_id)
  REFERENCES projects (id, tenant_id) ON DELETE CASCADE;
ALTER TABLE assets DROP CONSTRAINT assets_project_id_fkey,
  ADD CONSTRAINT assets_project_tenant_fkey FOREIGN KEY (project_id, tenant_id)
  REFERENCES projects (id, tenant_id) ON DELETE CASCADE;
ALTER TABLE pillars DROP CONSTRAINT pillars_project_id_fkey,
  ADD CONSTRAINT pillars_project_tenant_fkey FOREIGN KEY (project_id, tenant_id)
  REFERENCES projects (id, tenant_id) ON DELETE CASCADE;
ALTER TABLE content_items DROP CONSTRAINT content_items_project_id_fkey,
  ADD CONSTRAINT content_items_project_tenant_fkey FOREIGN KEY (project_id, tenant_id)
  REFERENCES projects (id, tenant_id) ON DELETE CASCADE;
ALTER TABLE image_assets DROP CONSTRAINT image_assets_project_id_fkey,
  ADD CONSTRAINT image_assets_project_tenant_fkey FOREIGN KEY (project_id, tenant_id)
  REFERENCES projects (id, tenant_id) ON DELETE CASCADE;
ALTER TABLE ideas DROP CONSTRAINT ideas_project_id_fkey,
  ADD CONSTRAINT ideas_project_tenant_fkey FOREIGN KEY (project_id, tenant_id)
  REFERENCES projects (id, tenant_id) ON DELETE CASCADE;
ALTER TABLE calendar_entries DROP CONSTRAINT calendar_entries_project_id_fkey,
  ADD CONSTRAINT calendar_entries_project_tenant_fkey FOREIGN KEY (project_id, tenant_id)
  REFERENCES projects (id, tenant_id) ON DELETE CASCADE;
ALTER TABLE offers DROP CONSTRAINT offers_project_id_fkey,
  ADD CONSTRAINT offers_project_tenant_fkey FOREIGN KEY (project_id, tenant_id)
  REFERENCES projects (id, tenant_id) ON DELETE CASCADE;
