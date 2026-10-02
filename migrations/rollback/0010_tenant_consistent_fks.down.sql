-- ROLLBACK for 0010_tenant_consistent_fks: back to single-column foreign keys.
-- Rows removed by the forward migration are not restored; they were invalid.
--   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -f migrations/rollback/0010_tenant_consistent_fks.down.sql
BEGIN;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['voice_samples', 'voice_pack_versions', 'voice_edit_signals', 'voice_pack_proposals'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_pack_tenant_fkey');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (pack_id) REFERENCES voice_packs (id) ON DELETE CASCADE',
      t, t || '_pack_id_fkey');
  END LOOP;
END $$;

ALTER TABLE voice_packs DROP CONSTRAINT IF EXISTS voice_packs_id_tenant_key;
DELETE FROM _migrations WHERE id = '0010_tenant_consistent_fks.sql';

COMMIT;
