-- =============================================================================
-- 0013_connections — Gmail, Google Docs, Google Calendar and LinkedIn, connected
-- by the person, read only with their consent (Voice spec G1, plan Flow 1).
--
-- One row per person per provider. Tokens are stored SEALED (AES-256-GCM, key
-- in the environment, never in the repo or the database): a database dump on
-- its own cannot be used to read anyone's mail.
--
-- Writing imported from a connection carries the connection and the provider's
-- own id, so a second import never duplicates a piece and disconnecting can
-- remove exactly what that connection brought in ("removing a source deletes
-- and rebuilds", plan Flow 4).
--
-- Tenant-consistent like 0010/0011: a sample can only point at a connection in
-- its own workspace, even though a foreign-key check ignores RLS.
-- =============================================================================

CREATE TABLE connections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('google', 'linkedin')),
  status            text NOT NULL DEFAULT 'connected'
                      CHECK (status IN ('connected', 'expired', 'error')),
  account_email     text,
  account_name      text,
  account_id        text,
  scopes            text[] NOT NULL DEFAULT '{}',
  access_token_enc  text NOT NULL,
  refresh_token_enc text,
  expires_at        timestamptz,
  -- Per capability (gmail, docs, calendar, posts): when it last ran, how many
  -- pieces it brought in, and the last error said in plain words.
  sync              jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, provider),
  UNIQUE (id, tenant_id)
);
CREATE INDEX idx_connections_tenant ON connections(tenant_id);
CREATE TRIGGER trg_connections_updated BEFORE UPDATE ON connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connections
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON connections TO huemen_app;

ALTER TABLE voice_samples ADD COLUMN connection_id uuid;
ALTER TABLE voice_samples ADD COLUMN external_id text;
ALTER TABLE voice_samples
  ADD CONSTRAINT voice_samples_connection_tenant_fkey
  FOREIGN KEY (connection_id, tenant_id) REFERENCES connections (id, tenant_id)
  ON DELETE SET NULL (connection_id);
CREATE UNIQUE INDEX idx_voice_samples_external
  ON voice_samples (pack_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_voice_samples_connection ON voice_samples (connection_id) WHERE connection_id IS NOT NULL;
