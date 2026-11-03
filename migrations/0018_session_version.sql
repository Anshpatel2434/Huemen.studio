-- Session revocation (brief §07, security review).
--
-- A session cookie carries the tenant and role claims that row-level security
-- keys on. Until now nothing could retire a cookie already in someone's
-- browser: changing a role or archiving a workspace only blocked the NEXT
-- sign-in, so a demoted user kept their old claim, and a copied cookie worked
-- for ever.
--
-- `session_version` fixes that. It is stamped into the cookie when a session
-- starts and compared on every request. Bumping the row invalidates every
-- cookie for that account at once: role changes, workspace archiving, and an
-- explicit "sign out everywhere".

ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN users.session_version IS
  'Bumped to invalidate every live session cookie for this user (role change, workspace archive, forced sign-out).';
