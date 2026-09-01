/**
 * Migration runner. Run with: `npm run db:migrate`.
 *
 * Steps:
 *   1. Bootstrap the RLS-enforced runtime role (`huemen_app`) + default grants,
 *      so every table created later is automatically readable/writable by the
 *      runtime role but still subject to RLS (INV-1).
 *   2. Apply numbered SQL files in ./migrations in order, each in its own
 *      transaction, tracked in the `_migrations` table. Re-running is a no-op.
 *
 * Connects as the ADMIN/owner role (DATABASE_ADMIN_URL). Never serves requests.
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

async function bootstrapRuntimeRole(pool: Pool) {
  const appPassword = process.env.DATABASE_APP_PASSWORD;
  if (!appPassword) throw new Error("DATABASE_APP_PASSWORD is required");

  const exists = await pool.query(
    "SELECT 1 FROM pg_roles WHERE rolname = 'huemen_app'",
  );
  // Build the DDL server-side with %L so the password is safely escaped.
  const ddlRes = await pool.query<{ sql: string }>(
    exists.rowCount
      ? `SELECT format('ALTER ROLE huemen_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', $1::text) AS sql`
      : `SELECT format('CREATE ROLE huemen_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text) AS sql`,
    [appPassword],
  );
  await pool.query(ddlRes.rows[0].sql);

  await pool.query("GRANT USAGE ON SCHEMA public TO huemen_app");
  // Auto-grant CRUD on every table/sequence created later by the owner role.
  await pool.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO huemen_app`,
  );
  await pool.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public
       GRANT USAGE, SELECT ON SEQUENCES TO huemen_app`,
  );
  // Grant on anything that already exists (idempotent re-runs).
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO huemen_app`,
  );
  await pool.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO huemen_app`,
  );
  console.log("✓ runtime role huemen_app bootstrapped");
}

async function applyMigrations(pool: Pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
       id text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const applied = new Set(
    (await pool.query<{ id: string }>("SELECT id FROM _migrations")).rows.map(
      (r) => r.id,
    ),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO _migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`✓ applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`✗ failed ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }
  // Re-run grants in case a migration created new tables (belt-and-suspenders).
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO huemen_app`,
  );
  await pool.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO huemen_app`,
  );
}

async function main() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required");
  const pool = new Pool({ connectionString: adminUrl, max: 4 });
  try {
    await bootstrapRuntimeRole(pool);
    await applyMigrations(pool);
    console.log("✓ migrations complete");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
