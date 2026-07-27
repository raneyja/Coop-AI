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

/**
 * Objects that must exist before we treat a migration as applied via docker-init
 * ledger backfill / false-ledger repair. Prefer tables; use columns when the
 * migration only ALTERs an existing table (e.g. 025).
 *
 * IMPORTANT: never backfill ledger rows without a probe — that marks SQL as
 * applied without running it (broke prod auth when 025 was skipped).
 */
const LEDGER_PROBES = {
  "018_org_integration_policies.sql": { table: "org_integration_policies" },
  "019_chat_threads.sql": { table: "chat_threads" },
  "024_repo_stats.sql": { table: "repo_stats" },
  "025_org_repos_browse_status.sql": { table: "org_repos", column: "browse_status" }
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

async function columnExists(client, tableName, columnName) {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
      ) AS ok
    `,
    [tableName, columnName]
  );
  return Boolean(result.rows[0]?.ok);
}

async function probeSatisfied(client, probe) {
  if (!(await tableExists(client, probe.table))) {
    return false;
  }
  if (probe.column) {
    return columnExists(client, probe.table, probe.column);
  }
  return true;
}

/** Remove ledger rows that were backfilled without the migration actually running. */
async function repairFalseLedgerEntries(client) {
  for (const [filename, probe] of Object.entries(LEDGER_PROBES)) {
    const recorded = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [
      filename
    ]);
    if (recorded.rowCount === 0) {
      continue;
    }
    if (await probeSatisfied(client, probe)) {
      continue;
    }
    await client.query("DELETE FROM schema_migrations WHERE filename = $1", [filename]);
    const missing = probe.column
      ? `${probe.table}.${probe.column}`
      : probe.table;
    console.log(`repair ${filename} (ledger entry present but ${missing} missing)`);
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

    // Only invent ledger rows we can verify. Unprobed migrations must run via apply.
    const ledgerProbe = LEDGER_PROBES[filename];
    if (!ledgerProbe || !(await probeSatisfied(client, ledgerProbe))) {
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
