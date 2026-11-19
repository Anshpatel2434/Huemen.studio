/**
 * Give an account a password (AUTH_PASSWORD_SIGNIN, migration 0028).
 *
 *   npx tsx scripts/set-password.ts <email> [--out <file>]
 *
 * Makes a new random password, stores only its hash, marks an invited account
 * active, and ends the account's other sessions. The password is written to
 * --out (appended, one "email  password" line) when given, else printed once.
 * Hand it over privately; it cannot be read back later.
 *
 * Point it at a database with DOTENV_CONFIG_PATH, like db:migrate.
 */
import "dotenv/config";
import { appendFileSync } from "node:fs";
import { withTenantSession } from "@/db/session";
import { generatePassword, hashPassword } from "@/lib/auth/password";

async function main() {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const out = outAt >= 0 ? args[outAt + 1] : null;
  const email = args.find((a, i) => !a.startsWith("--") && i !== outAt + 1)?.trim().toLowerCase();
  if (!email) throw new Error("Usage: npx tsx scripts/set-password.ts <email> [--out <file>]");

  const password = generatePassword();
  const hash = await hashPassword(password);
  const admin = { tenantId: null, userId: null, isPlatformAdmin: true } as const;
  const r = await withTenantSession(admin, (c) =>
    c.query<{ email: string; role: string }>(
      `UPDATE users SET password_hash = $2, session_version = session_version + 1,
              status = CASE status WHEN 'invited' THEN 'active' ELSE status END
        WHERE lower(email) = $1 RETURNING email, role`,
      [email, hash],
    ),
  );
  if (!r.rowCount) throw new Error(`No account for ${email}.`);
  if (out) {
    appendFileSync(out, `${r.rows[0].email}  ${password}\n`, { mode: 0o600 });
    console.log(`Password set for ${r.rows[0].email} (${r.rows[0].role}); written to ${out}.`);
  } else {
    console.log(`Password set for ${r.rows[0].email} (${r.rows[0].role}): ${password}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
