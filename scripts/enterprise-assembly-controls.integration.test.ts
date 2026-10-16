import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { JobQueue } from "../src/jobs/jobQueue";
import { PostgresQueueBackend } from "../src/jobs/backends/postgresBackend";
import { loadJobQueueConfig } from "../src/config/jobQueueConfig";
import { JobType } from "../src/jobs/types";
import { withJobOwnedEffect } from "../src/jobs/jobEffectAdmission";
import { RepoStatsStore } from "../src/workspace/repoStatsStore";
import { OrgStore } from "../src/server/orgStore";

const {publicationDatabaseFromEnvironment} = require('./publication-test-fixture.mjs');
const url: string = publicationDatabaseFromEnvironment(process.env, 'assembly');
process.env.DATABASE_SSL = "false";
const pool = new Pool({ connectionString: url, ssl: false });
const backend = new PostgresQueueBackend(url);
const queue = new JobQueue({ ...loadJobQueueConfig({}), backend: "postgres", databaseUrl: url, schedules: [] }, backend);
after(async () => { await backend.close(); await pool.end(); });

test("assembled migration chain has exact committed checksums after two actual runner calls", async () => {
  assert.equal((await pool.query("SELECT to_regclass('public.jobs') AS jobs")).rows[0].jobs, null, "Use a fresh explicitly owned fixture; preserve existing stale-job quarantine evidence.");
  const { runMigrations } = await import("./run-migrations.mjs");
  await runMigrations({ databaseUrl: url, migrationsDir: path.join(process.cwd(), "migrations"), log: () => undefined });
  await runMigrations({ databaseUrl: url, migrationsDir: path.join(process.cwd(), "migrations"), log: () => undefined });
  const files = readdirSync(path.join(process.cwd(), "migrations")).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const rows = (await pool.query("SELECT filename, checksum FROM schema_migrations ORDER BY filename")).rows;
  assert.equal(rows.length, files.length); assert.ok(files.length >= 36, "The preserved baseline chain cannot disappear");
  for (const [i, filename] of files.entries()) {
    assert.equal(rows[i].filename, filename);
    assert.equal(rows[i].checksum, createHash("sha256").update(readFileSync(path.join("migrations", filename))).digest("hex"));
  }
});

test("real admitted job transaction persists non-default branch, counts and org status together", async () => {
  const org = randomUUID(); const repo = `github:fixture/assembly-branch-${org}`;
  await pool.query("INSERT INTO organizations(id,name,plan) VALUES($1,'owned assembly','pro')", [org]);
  const created = await queue.createJob({ type: JobType.INDEX_REPOSITORY, params: { orgId: org, repoId: repo }, userId: org, bypassRateLimit: true });
  const job = await queue.claimNext(randomUUID(), 30_000); assert.ok(job);
  assert.equal(job.id, created.jobId);
  const store = new OrgStore(pool);
  await withJobOwnedEffect(pool, job, async client => {
    await new RepoStatsStore(client).upsertStats(org, repo, { branch: "release/fixture-non-main", fileCount: 3,
      lineCount: 17, byteCount: 53, languages: ["TypeScript"], headCommit: "fixture-head", indexedAt: new Date() });
    await store.upsertOrgRepo(org, repo, { indexStatus: "ready", lastJobId: job.id }, client);
  });
  const stats = await new RepoStatsStore(pool).loadStats(org, repo);
  assert.equal(stats?.branch, "release/fixture-non-main"); assert.equal(stats?.lineCount, 17);
  assert.equal((await store.getOrgRepo(org, repo))?.lastJobId, job.id);
  await assert.rejects(withJobOwnedEffect(pool, job, async client => {
    await new RepoStatsStore(client).upsertStats(org, repo, { branch: "incorrect-after-fault", fileCount: 99,
      lineCount: 99, byteCount: 99, languages: [], indexedAt: new Date() });
    await store.upsertOrgRepo(org, repo, { indexStatus: "error" }, client);
    throw new Error("owned fixture rollback");
  }), /owned fixture rollback/);
  assert.equal((await new RepoStatsStore(pool).loadStats(org, repo))?.branch, "release/fixture-non-main");
  assert.equal((await store.getOrgRepo(org, repo))?.indexStatus, "ready");
  await pool.query("UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [job.id]);
  let entered = false;
  await assert.rejects(withJobOwnedEffect(pool, job, async () => { entered = true; }), /lost ownership/);
  assert.equal(entered, false); assert.equal((await new RepoStatsStore(pool).loadStats(org, repo))?.branch, "release/fixture-non-main");
});

test("billing-bound org store preserves query-client rollback for repo methods", async () => {
  const org = randomUUID(); const repo = "github:fixture/bound-transaction";
  await pool.query("INSERT INTO organizations(id,name,plan) VALUES($1,'owned transaction','pro')", [org]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const store = new OrgStore(pool).inTransaction(client);
    await store.upsertOrgRepo(org, repo, { indexStatus: "queued" });
    assert.equal((await store.getOrgRepo(org, repo))?.indexStatus, "queued");
    await client.query("ROLLBACK");
  } finally { client.release(); }
  assert.equal(await new OrgStore(pool).getOrgRepo(org, repo), undefined);
});
