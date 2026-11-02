-- =============================================================================
-- 0017_rate_hits — short-window limits on what costs money or sends mail.
--
-- The monthly cap (tenant_usage_caps) stops a workspace that spends too much
-- over a month; nothing stopped one person, or a stuck loop, firing hundreds of
-- model calls in a minute, or asking for sign-in emails over and over. Each
-- accepted call leaves one row here; lib/ratelimit counts the rows in the
-- window before letting the next one through. Refused calls leave nothing.
--
-- Postgres rather than memory, because serverless instances share nothing.
-- Rows older than a day are pruned on the next hit for the same workspace.
-- Tenant-scoped with RLS like every other table (INV-1).
-- =============================================================================

CREATE TABLE rate_hits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  bucket     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rate_hits_window ON rate_hits (tenant_id, bucket, created_at);

ALTER TABLE rate_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_hits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON rate_hits
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
GRANT SELECT, INSERT, DELETE ON rate_hits TO huemen_app;
