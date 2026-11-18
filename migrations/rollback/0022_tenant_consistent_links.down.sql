-- Rollback of 0022: back to single-column foreign keys (the weaker form).

ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_pillar_tenant_fkey,
  ADD CONSTRAINT content_items_pillar_id_fkey FOREIGN KEY (pillar_id) REFERENCES pillars (id) ON DELETE SET NULL;
ALTER TABLE ideas DROP CONSTRAINT IF EXISTS ideas_pillar_tenant_fkey,
  ADD CONSTRAINT ideas_pillar_id_fkey FOREIGN KEY (pillar_id) REFERENCES pillars (id) ON DELETE SET NULL;
ALTER TABLE calendar_entries DROP CONSTRAINT IF EXISTS calendar_entries_pillar_tenant_fkey,
  ADD CONSTRAINT calendar_entries_pillar_id_fkey FOREIGN KEY (pillar_id) REFERENCES pillars (id) ON DELETE SET NULL;
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_source_tenant_fkey,
  ADD CONSTRAINT content_items_source_content_item_id_fkey FOREIGN KEY (source_content_item_id) REFERENCES content_items (id) ON DELETE SET NULL;
ALTER TABLE content_generations DROP CONSTRAINT IF EXISTS content_generations_item_tenant_fkey,
  ADD CONSTRAINT content_generations_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES content_items (id) ON DELETE CASCADE;
ALTER TABLE image_assets DROP CONSTRAINT IF EXISTS image_assets_item_tenant_fkey,
  ADD CONSTRAINT image_assets_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES content_items (id) ON DELETE SET NULL;
ALTER TABLE ideas DROP CONSTRAINT IF EXISTS ideas_converted_item_tenant_fkey,
  ADD CONSTRAINT ideas_converted_to_content_item_id_fkey FOREIGN KEY (converted_to_content_item_id) REFERENCES content_items (id) ON DELETE SET NULL;
ALTER TABLE calendar_entries DROP CONSTRAINT IF EXISTS calendar_entries_item_tenant_fkey,
  ADD CONSTRAINT calendar_entries_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES content_items (id) ON DELETE SET NULL;
ALTER TABLE generation_logs DROP CONSTRAINT IF EXISTS generation_logs_item_tenant_fkey,
  ADD CONSTRAINT generation_logs_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES content_items (id) ON DELETE SET NULL;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_idea_tenant_fkey,
  ADD CONSTRAINT projects_idea_id_fkey FOREIGN KEY (idea_id) REFERENCES ideas (id) ON DELETE SET NULL;
ALTER TABLE brand_profiles DROP CONSTRAINT IF EXISTS brand_profiles_voice_pack_tenant_fkey,
  ADD CONSTRAINT brand_profiles_voice_pack_id_fkey FOREIGN KEY (voice_pack_id) REFERENCES voice_packs (id) ON DELETE SET NULL;
ALTER TABLE visual_identities DROP CONSTRAINT IF EXISTS visual_identities_logo_tenant_fkey,
  ADD CONSTRAINT visual_identities_logo_asset_id_fkey FOREIGN KEY (logo_asset_id) REFERENCES assets (id) ON DELETE SET NULL;
ALTER TABLE voice_guides DROP CONSTRAINT IF EXISTS voice_guides_profile_tenant_fkey,
  ADD CONSTRAINT voice_guides_brand_profile_id_fkey FOREIGN KEY (brand_profile_id) REFERENCES brand_profiles (id) ON DELETE CASCADE;
ALTER TABLE visual_identities DROP CONSTRAINT IF EXISTS visual_identities_profile_tenant_fkey,
  ADD CONSTRAINT visual_identities_brand_profile_id_fkey FOREIGN KEY (brand_profile_id) REFERENCES brand_profiles (id) ON DELETE CASCADE;
ALTER TABLE pillars DROP CONSTRAINT IF EXISTS pillars_profile_tenant_fkey,
  ADD CONSTRAINT pillars_brand_profile_id_fkey FOREIGN KEY (brand_profile_id) REFERENCES brand_profiles (id) ON DELETE CASCADE;
ALTER TABLE brand_profiles DROP CONSTRAINT IF EXISTS brand_profiles_project_tenant_fkey,
  ADD CONSTRAINT brand_profiles_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_project_tenant_fkey,
  ADD CONSTRAINT assets_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE pillars DROP CONSTRAINT IF EXISTS pillars_project_tenant_fkey,
  ADD CONSTRAINT pillars_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_project_tenant_fkey,
  ADD CONSTRAINT content_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE image_assets DROP CONSTRAINT IF EXISTS image_assets_project_tenant_fkey,
  ADD CONSTRAINT image_assets_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE ideas DROP CONSTRAINT IF EXISTS ideas_project_tenant_fkey,
  ADD CONSTRAINT ideas_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE calendar_entries DROP CONSTRAINT IF EXISTS calendar_entries_project_tenant_fkey,
  ADD CONSTRAINT calendar_entries_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_project_tenant_fkey,
  ADD CONSTRAINT offers_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE;
ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_id_tenant_key;
ALTER TABLE ideas DROP CONSTRAINT IF EXISTS ideas_id_tenant_key;
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_id_tenant_key;
ALTER TABLE brand_profiles DROP CONSTRAINT IF EXISTS brand_profiles_id_tenant_key;
