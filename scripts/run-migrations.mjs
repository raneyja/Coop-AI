#!/usr/bin/env node
/** Apply SQL and its SHA-256 ledger row atomically, serialized per database. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import databasePoolOptions from "../src/server/databasePoolOptions.cjs";

// Lex only statement boundaries: preserve strings, nested comments and dollar bodies.
export function migrationStatements(sql) {
  const statements = [];
  let start = 0, i = 0, quote = null, dollar = null, depth = 0, escapeString = false;
  while (i < sql.length) {
    if (depth) {
      if (sql.startsWith("/*", i)) { depth++; i += 2; }
      else if (sql.startsWith("*/", i)) { depth--; i += 2; }
      else i++;
    } else if (dollar) {
      if (sql.startsWith(dollar, i)) { i += dollar.length; dollar = null; }
      else i++;
    } else if (quote) {
      if (sql[i] === quote) {
        if (sql[i + 1] === quote) i += 2;
        else { quote = null; i++; }
      } else if (sql[i] === "\\" && quote === "'" && escapeString) {
        // Conservative: escaped-string spelling must use E'', not ambiguous SQL mode.
        i += 2;
      } else i++;
    } else if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i); i = end < 0 ? sql.length : end + 1;
    } else if (sql.startsWith("/*", i)) { depth = 1; i += 2;
    } else if (sql[i] === "'" || sql[i] === '"') { escapeString = sql[i] === "'" && (i > 0 && /[eE]/.test(sql[i - 1]) && (i === 1 || !/[A-Za-z0-9_$\u0080-\uffff]/.test(sql[i - 2]))); quote = sql[i++];
    } else if ((i === 0 || !/[A-Za-z0-9_$\u0080-\uffff]/.test(sql[i - 1])) && sql[i] === "$" && /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.test(sql.slice(i))) {
      dollar = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)[0]; i += dollar.length;
    } else if (sql[i] === ";") { statements.push(sql.slice(start, ++i)); start = i;
    } else i++;
  }
  if (quote || dollar || depth) throw new Error("Unterminated SQL quote/comment");
  statements.push(sql.slice(start));
  return statements.filter((statement) => statementHead(statement));
}

function statementHead(statement) {
  let text = statement;
  while (true) {
    text = text.trimStart();
    if (text.startsWith("--")) { const end = text.indexOf("\n"); text = end < 0 ? "" : text.slice(end + 1); }
    else if (text.startsWith("/*")) {
      let depth = 1, i = 2;
      while (depth && i < text.length) {
        if (text.startsWith("/*", i)) { depth++; i += 2; }
        else if (text.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      text = text.slice(i);
    } else break;
  }
  return text.trim();
}

export function prepareMigration(sql) {
  const statements = migrationStatements(sql);
  if (/^BEGIN\s*;?$/i.test(statementHead(statements[0] ?? ""))) {
    if (!/^COMMIT\s*;?$/i.test(statementHead(statements.at(-1) ?? ""))) throw new Error("Unpaired migration transaction wrapper");
    statements.shift(); statements.pop();
  }
  for (const statement of statements) {
    const head = statementHead(statement);
    if (/^(?:BEGIN|START|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE|SET\s+(?:SESSION\s+CHARACTERISTICS|TRANSACTION))\b/i.test(head)) {
      throw new Error("Migration transaction control is owned by the runner");
    }
    // Nontransactional changes need a separately reviewed resumable migration protocol.
    if (/^(?:VACUUM|CREATE\s+DATABASE|DROP\s+DATABASE|ALTER\s+SYSTEM|CALL|COPY)\b/i.test(head) || /^(?:CREATE|DROP|REINDEX)\b[^;]*\bCONCURRENTLY\b/i.test(head)) {
      throw new Error("Unsupported nontransactional/externally acting migration statement");
    }
    if (/^SET\b/i.test(head)) throw new Error("Migration session settings are owned by the runner");
  }
  return statements;
}

export async function runMigrations({ databaseUrl, migrationsDir, log = console.log }) {
  if (!databaseUrl) throw new Error("DATABASE_URL must explicitly select the migration target");
  let target;
  try {
    target = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(target.protocol)) throw new Error();
  } catch { throw new Error("DATABASE_URL must be a valid PostgreSQL URL"); }
  if (!target.hostname || target.pathname.length < 2) throw new Error("DATABASE_URL must include an explicit host and database");
  for (const key of ["host", "hostaddr", "port", "database", "dbname", "user", "password", "options"]) {
    if (target.searchParams.has(key)) throw new Error("Migration target/session overrides in URL query parameters are unsupported");
  }
  const candidates = fs.readdirSync(migrationsDir).filter((name) => /\.sql$/i.test(name));
  if (!candidates.length) throw new Error("Migration directory contains no SQL migrations");
  for (const name of candidates) {
    if (!/^\d{3}_[A-Za-z0-9_]+\.sql$/.test(name)) throw new Error("Unexpected SQL migration filename; expected NNN_name.sql");
  }
  const files = candidates.sort();
  const migrations = files.map((filename) => {
    const bytes = fs.readFileSync(path.join(migrationsDir, filename));
    return { filename, checksum: createHash("sha256").update(bytes).digest("hex"), statements: prepareMigration(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  });
  const pool = new pg.Pool(databasePoolOptions(databaseUrl));
  let client;
  try {
    client = await pool.connect();
    await client.query("SET standard_conforming_strings = on");
    await client.query("SELECT pg_advisory_lock(1129271120, 10)");
    await client.query("BEGIN");
    try {
      const ledger = await client.query("SELECT to_regclass('public.schema_migrations') AS ledger, EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.classid='pg_class'::regclass AND d.deptype='e')) AS has_tables");
      if (!ledger.rows[0].ledger && ledger.rows[0].has_tables) throw new Error("Existing unledgered schema: explicit legacy adoption review required; no automatic probe backfill");
      await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), checksum TEXT)`);
      await client.query("ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    const ledgerRows = await client.query("SELECT filename, checksum FROM public.schema_migrations");
    for (const row of ledgerRows.rows) {
      const migration = migrations.find((item) => item.filename === row.filename);
      if (row.checksum !== null && (!migration || migration.checksum !== row.checksum)) throw new Error(`Applied migration missing or content changed: ${row.filename}`);
    }
    const legacyProbes = {
      "018_org_integration_policies.sql": ["org_integration_policies"],
      "019_chat_threads.sql": ["chat_threads"],
      "024_repo_stats.sql": ["repo_stats"],
      "025_org_repos_browse_status.sql": ["org_repos", "browse_status"],
      "026_repo_dependency_edges.sql": ["repo_dependency_edges"]
    };
    for (const row of ledgerRows.rows) {
      const probe = legacyProbes[row.filename];
      if (!probe) continue;
      const check = await client.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND ($2::text IS NULL OR column_name = $2)) AS ok", [probe[0], probe[1] ?? null]);
      if (!check.rows[0].ok) throw new Error(`Legacy ledger/schema mismatch: ${row.filename}; explicit recovery review required`);
    }
    for (const migration of migrations) {
      const recorded = await client.query("SELECT checksum FROM public.schema_migrations WHERE filename = $1", [migration.filename]);
      if (recorded.rowCount) {
        if (recorded.rows[0].checksum !== null && recorded.rows[0].checksum !== migration.checksum) throw new Error(`Applied migration content changed: ${migration.filename}`);
        log(`skip ${migration.filename}${recorded.rows[0].checksum === null ? " (legacy; historical checksum unknown)" : " (verified checksum)"}`);
        continue;
      }
      log(`apply ${migration.filename}`);
      await client.query("BEGIN");
      try {
        for (const statement of migration.statements) await client.query(statement);
        await client.query("INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)", [migration.filename, migration.checksum]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
    log("Migrations complete.");
  } finally {
    // Destroy this dedicated session: advisory locks and aborted transactions cannot leak.
    client?.release(true);
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations({ databaseUrl: process.env.DATABASE_URL, migrationsDir: process.env.MIGRATIONS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations") })
    .catch((error) => { console.error(`Migration failed: ${error.message}`); process.exitCode = 1; });
}
