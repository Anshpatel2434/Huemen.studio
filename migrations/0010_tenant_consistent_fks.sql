-- =============================================================================
-- 0010_tenant_consistent_fks — a child row's tenant must be its parent's.
--
-- Found by a test: a session in workspace B could insert a voice sample that
-- pointed at workspace A's pack. Row-level security stopped B from READING
-- anything of A's, but a foreign-key check runs as the table owner and ignores
-- RLS, so a row with B's tenant_id attached itself to A's pack id. Nothing
-- leaked, but two tenants' rows were joined, which INV-1 says can't happen.
--
-- The fix makes the database refuse it outright: every child of voice_packs
-- references (id, tenant_id) together, so the child's tenant has to equal the
-- pack's. The app layer also checks the pack is visible before inserting
-- (lib/data/voice-pack `addSamples`); this is the line beneath it.
--
-- Any existing mismatched rows are invalid by definition and are removed, with
-- the count reported. On a clean database there are none.
-- =============================================================================

ALTER TABLE voice_packs ADD CONSTRAINT voice_packs_id_tenant_key UNIQUE (id, tenant_id);

DO $$
DECLARE
  t text;
  n integer;
BEGIN
  FOREACH t IN ARRAY ARRAY['voice_samples', 'voice_pack_versions', 'voice_edit_signals', 'voice_pack_proposals'] LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'DELETE FROM %I c USING voice_packs p WHERE c.pack_id = p.id AND c.tenant_id <> p.tenant_id', t);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '0010: removed % cross-tenant rows from %', n, t; END IF;

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_pack_id_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (pack_id, tenant_id) REFERENCES voice_packs (id, tenant_id) ON DELETE CASCADE',
      t, t || '_pack_tenant_fkey');
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
