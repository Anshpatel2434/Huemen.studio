-- =============================================================================
-- 0024_admin_tables_read_only — a workspace's own scope may READ its rows in
-- the admin-owned tables, never change them.
--
-- users, tenants, coach_assignments, tenant_usage_caps and admin_audit_log are
-- written only by admin code paths (lib/data/admin, lib/data/auth), which run
-- in the admin scope (admin_all policy). Their tenant_isolation policy was
-- FOR ALL, so the database itself would have let a client-scoped session
-- change its own role to admin, lift its own usage caps, or delete its own
-- audit trail; only application code stood in the way (2026-11-17 isolation
-- test, finding F6). Now the database refuses it too.
-- =============================================================================

DROP POLICY tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users FOR SELECT USING (tenant_id = app_current_tenant());

DROP POLICY tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants FOR SELECT USING (tenant_id = app_current_tenant());

DROP POLICY tenant_isolation ON coach_assignments;
CREATE POLICY tenant_isolation ON coach_assignments FOR SELECT USING (tenant_id = app_current_tenant());

DROP POLICY tenant_isolation ON tenant_usage_caps;
CREATE POLICY tenant_isolation ON tenant_usage_caps FOR SELECT USING (tenant_id = app_current_tenant());

DROP POLICY tenant_isolation ON admin_audit_log;
CREATE POLICY tenant_isolation ON admin_audit_log FOR SELECT USING (tenant_id = app_current_tenant());

