#!/usr/bin/env node
/**
 * Apply pending SQL migrations (schema_migrations ledger).
 * Used by Railway preDeployCommand and local/CI when psql is unavailable.
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
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://coop:coop@127.0.0.1:5432/coopai";

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL not set — using local Docker Compose default (coop@127.0.0.1:5432/coopai)");
}

function poolConfig(connectionString) {
  const needsSsl =
    process.env.DATABASE_SSL === "true" ||
    /sslmode=(require|verify-ca|verify-full)/i.test(connectionString);
  return needsSsl
    ? { connectionString, ssl: { rejectUnauthorized: false } }
    : { connectionString };
}

/** Table that must exist before we backfill a migration into schema_migrations. */
const LEDGER_TABLE_PROBES = {
  "018_org_integration_policies.sql": "org_integration_policies",
  "019_chat_threads.sql": "chat_threads"
};

async function tableExists(client, tableName) {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
      ) AS ok
    `,
    [tableName]
  );
  return Boolean(result.rows[0]?.ok);
}

/** Remove ledger rows that were backfilled without the migration actually running. */
async function repairFalseLedgerEntries(client) {
  for (const [filename, tableName] of Object.entries(LEDGER_TABLE_PROBES)) {
    const recorded = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [
      filename
    ]);
    if (recorded.rowCount === 0) {
      continue;
    }
    if (await tableExists(client, tableName)) {
      continue;
    }
    await client.query("DELETE FROM schema_migrations WHERE filename = $1", [filename]);
    console.log(`repair ${filename} (ledger entry present but ${tableName} missing)`);
  }
}

/** Docker Compose mounts migrations into initdb.d — schema exists but ledger may only list 001. */
async function syncDockerInitLedger(client, filenames) {
  const probe = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'organizations'
    ) AS has_orgs
  `);
  if (!probe.rows[0]?.has_orgs) {
    return;
  }

  for (const filename of filenames) {
    const recorded = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [
      filename
    ]);
    if (recorded.rowCount > 0) {
      continue;
    }

    const version = Number.parseInt(filename.slice(0, 3), 10);
    if (!Number.isFinite(version) || version < 2) {
      continue;
    }

    const requiredTable = LEDGER_TABLE_PROBES[filename];
    if (requiredTable && !(await tableExists(client, requiredTable))) {
      continue;
    }

    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
      [filename]
    );
    console.log(`sync  ${filename} (docker-init ledger backfill)`);
  }
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
      .filter((name) => name.endsWith(".sql") && !/ \d/.test(name))
      .sort();

    console.log(`Using DATABASE_URL (host redacted)`);
    console.log(`Migrations directory: ${migrationsDir}`);

    await repairFalseLedgerEntries(client);
    await syncDockerInitLedger(client, files);

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
