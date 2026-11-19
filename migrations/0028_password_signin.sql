-- =============================================================================
-- 0028_password_signin — an optional password on an account.
--
-- Sign-in is by emailed link (brief §02). A host with no email service yet
-- (2026-11-19: the first client deploy) cannot send that link, so
-- AUTH_PASSWORD_SIGNIN=true lets an account sign in with a password instead:
-- set when an invite is accepted, or by scripts/set-password.ts. Still
-- invite-only; there is no sign-up and no reset by email.
--
-- password_hash is "scrypt$N$salt$hash" (lib/auth/password). Null means the
-- account has no password and can only use the emailed link.
-- =============================================================================

ALTER TABLE users ADD COLUMN password_hash text
  CONSTRAINT users_password_hash_check CHECK (password_hash IS NULL OR password_hash LIKE 'scrypt$%');
