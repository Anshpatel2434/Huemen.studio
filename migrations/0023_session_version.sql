-- =============================================================================
-- 0023_session_version — signing out ends the session on the server.
--
-- The session cookie is a signed value, valid for 8 hours. Signing out used to
-- delete it from the browser only, so a copy of the cookie (another device, a
-- leaked header) still worked until it expired (2026-11-17 isolation test).
-- The cookie now carries the account's session_version; the account is read
-- again on every request anyway, and a cookie whose version is behind is
-- refused. Signing out raises the version, which ends every session of that
-- account at once.
-- =============================================================================

ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 0;
