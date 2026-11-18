-- Rollback of 0024: the tenant scope may write its own rows again (the weaker form).

DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

DROP POLICY IF EXISTS tenant_isolation ON coach_assignments;
CREATE POLICY tenant_isolation ON coach_assignments FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

DROP POLICY IF EXISTS tenant_isolation ON tenant_usage_caps;
CREATE POLICY tenant_isolation ON tenant_usage_caps FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

DROP POLICY IF EXISTS tenant_isolation ON admin_audit_log;
CREATE POLICY tenant_isolation ON admin_audit_log FOR ALL USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

