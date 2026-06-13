#!/usr/bin/env node
/**
 * Apply pending SQL migrations (schema_migrations ledger).
 * Used by Railway releaseCommand and local/CI when psql is unavailable.
 *
 * Requires: DATABASE_URL, migrations/*.sql in cwd (or MIGRATIONS_DIR).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const migrationsDir = process.env.MIGRATIONS_DIR ?? path.join(root, "migrations");
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

function poolConfig(connectionString) {
  const needsSsl =
    process.env.DATABASE_SSL === "true" ||
    /sslmode=(require|verify-ca|verify-full)/i.test(connectionString);
  return needsSsl
    ? { connectionString, ssl: { rejectUnauthorized: false } }
    : { connectionString };
}

async function main() {
  const pool = new pg.Pool(poolConfig(databaseUrl));
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql") && !name.includes(" 2"))
      .sort();

    console.log(`Using DATABASE_URL (host redacted)`);
    console.log(`Migrations directory: ${migrationsDir}`);

    for (const filename of files) {
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [filename]
      );
      if (applied.rowCount > 0) {
        console.log(`skip  ${filename} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
      console.log(`apply ${filename}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    console.log("Migrations complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
