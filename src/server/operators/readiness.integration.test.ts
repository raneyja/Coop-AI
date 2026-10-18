// Fresh suite-bound actual Docker admission must precede all database constructors.
const {publicationDatabaseFromEnvironment} = require('../../../scripts/publication-test-fixture.mjs');
const releaseDatabase: string = publicationDatabaseFromEnvironment(process.env, 'readiness');
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { Pool } from "pg";
import { GraphCache, blankRepositoryGraph } from "../../cache/graphCache";
import { PersistingGraphCache } from "../../cache/graphCachePostgres";
import { loadJobQueueConfig } from "../../config/jobQueueConfig";
import { loadWebhookConfig } from "../../config/webhookConfig";
import { createJobRuntime, stopJobRuntime } from "../../jobs/jobRuntime";
import { JobType } from "../../jobs/types";
import { WorkerPresence, workerArtifactSha256 } from "../../jobs/workerPresence";
import { loadServerConfig } from "../serverConfig";
import { OperatorStore } from "./operatorStore";
import { OperatorReadiness } from "./readiness";

const URL = releaseDatabase;
const fixturePort = Number(new globalThis.URL(URL).port);
function fixtureWithPort(port: number): string {
  const value = new globalThis.URL(URL); value.port = String(port); return value.toString();
}
const pool = new Pool({ connectionString: URL });
const source = resolve(process.cwd(), "migrations");
const env = {
  NODE_ENV: "production", DATABASE_URL: URL, JOBS_BACKEND: "postgres", JOBS_WORKERS: "0",
  GRAPH_CACHE_BACKEND: "postgres", CREDENTIALS_ENCRYPTION_KEY: Buffer.from(Array.from({length:32},(_,index)=>index)).toString("base64")
};
const config = loadWebhookConfig(env);
const serverConfig = loadServerConfig(env);
let completed = 0;
const ingressMeasurements: Record<string, number> = {};
const controls: string[] = [];
async function control(name: string, fn: () => Promise<void>) { await fn(); controls.push(name); completed++; }
async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
async function probe(base: string, token?: string) {
  const response = await fetch(`${base}/v1/operator/readiness`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(4000) });
  const decoded: unknown = await response.json();
  assert(decoded && typeof decoded === "object" && !Array.isArray(decoded));
  const body = decoded as { error?: string; ready?: boolean; checks: Record<string, { status: string; reason?: string; publication?: Record<string, number>; counts?: Record<string, number> }> };
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert(!JSON.stringify(body).includes("eh02-disposable-only"));
  assert(!JSON.stringify(body).includes("synthetic-readiness-key"));
  return { response, body };
}

async function rawReadiness(base: string, token: string | undefined, framing: string, partialBody = "", pathname = "/v1/operator/readiness") {
  const target = new globalThis.URL(base);
  const socket = connect({ host: target.hostname, port: Number(target.port) });
  let response = "";
  socket.on("data", chunk => { response += chunk.toString(); assert(response.length < 65536); });
  socket.on("error", () => undefined);
  try {
    await once(socket, "connect", { signal: AbortSignal.timeout(1000) });
    const end = once(socket, "end", { signal: AbortSignal.timeout(2300) });
    const start = performance.now();
    socket.write(`GET ${pathname} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nOrigin: http://localhost:3001\r\nX-Request-Id: eh11-ingress-control\r\n${token ? `Authorization: Bearer ${token}\r\n` : ""}${framing}\r\n${partialBody}`);
    await end;
    const elapsed = performance.now() - start;
    const status = Number(/^HTTP\/1\.1 (\d+)/.exec(response)?.[1]);
    assert(Number.isInteger(status));
    assert(response.includes("x-request-id: eh11-ingress-control"));
    assert(response.includes("Access-Control-Allow-Origin: http://localhost:3001"));
    assert(!response.includes("synthetic-readiness-key"));
    return { status, response, elapsed };
  } finally { socket.destroy(); }
}

test("operator readiness actual HTTP/PG and owned cleanup", async () => {
  const identity = await pool.query("SELECT current_database() AS db,current_user AS usr,inet_server_port() AS port");
  assert.equal(identity.rows[0].db, "eh02_disposable"); assert.equal(identity.rows[0].usr, "eh02");
  assert.equal(new globalThis.URL(URL).hostname, "127.0.0.1");
  const operatorStore = new OperatorStore(pool);
  const op = await pool.query("INSERT INTO operators(email,role) VALUES ('eh11-readiness@fixture.invalid','viewer') ON CONFLICT(lower(email)) DO UPDATE SET disabled_at=NULL,role='viewer' RETURNING id");
  const session = await operatorStore.createSession(String(op.rows[0].id));
  const jobs = createJobRuntime({ config: loadJobQueueConfig(env), cache: new GraphCache() });
  const cache = new PersistingGraphCache({ pool });
  // Run the actual separately built backend artifact: bundling an imported main entry into
  // this test would collapse require.main identities and accidentally launch default config.
  const api = spawn(process.execPath, ["-e", `const api=require('./dist/webhookServer.js');api.createWebhookServer().then(r=>{r.server.listen(0,'127.0.0.1',()=>process.send({port:r.server.address().port}));});`],
    { cwd:process.cwd(), env:{ ...env, PATH:process.env.PATH }, stdio:["ignore","pipe","pipe","ipc"] });
  api.stdout?.resume(); api.stderr?.resume();
  const [message]: unknown[] = await once(api,"message",{signal:AbortSignal.timeout(5000)});
  assert(message && typeof message === "object" && "port" in message && typeof message.port === "number");
  const base=`http://127.0.0.1:${message.port}`;
  const temp = mkdtempSync(resolve(tmpdir(), "eh11-artifact-"));
  const children: Server[] = [];
  const diagnosticOwners: OperatorReadiness[] = [];
  async function custom(overrides: Partial<ConstructorParameters<typeof OperatorReadiness>[0]> = {}) {
    const owner = new OperatorReadiness({ databaseUrl: URL, serverConfig, cacheConfig: config.cache, cache, jobs, ...overrides });
    const server = createServer(async (req, res) => owner.handle({ authorization: req.headers.authorization }, res));
    diagnosticOwners.push(owner); children.push(server); return listen(server);
  }
  async function publishedGraph(run: (owner: PersistingGraphCache, orgId: string, repoId: string) => Promise<void>) {
    const orgId = randomUUID(), repoId = "github:synthetic/readiness";
    const owner = new PersistingGraphCache({ pool });
    await pool.query("INSERT INTO organizations(id,name) VALUES($1,'synthetic private readiness org')", [orgId]);
    try {
      const graph = blankRepositoryGraph({ repoId, owner: "synthetic", repo: "readiness", provider: "github" });
      graph.fileTree = [{ path: "private-fixture-path.ts", size: 1, sha: "private-fixture-sha", lastModified: new Date(), lastAuthor: "private-fixture-author" }];
      owner.setGraph(orgId, graph); await owner.flush();
      await run(owner, orgId, repoId);
    } finally {
      await owner.close().catch(() => assert(owner.getPersistenceState().failed || owner.getFailedJobPublications().length > 0));
      await pool.query("DELETE FROM organizations WHERE id=$1", [orgId]);
    }
  }
  async function fleet(run: (context: { id: string; hash: string; presence: WorkerPresence;
    state: { acceptingWork: boolean; capacity: number; activeJobs: number };
    config: ReturnType<typeof loadServerConfig>; base: string }) => Promise<void>) {
    const id = `s79-${randomUUID()}`;
    const hash = workerArtifactSha256(resolve(process.cwd(), "dist/workerEntry.js"));
    const state = { acceptingWork: true, capacity: 2, activeJobs: 0 };
    const expected = loadServerConfig({ ...env, COOP_WORKER_FLEET_ID: id,
      COOP_EXPECTED_WORKER_SHA256: hash, COOP_MIN_READY_WORKERS: "1" });
    const presence = new WorkerPresence({ databaseUrl: URL, fleetId: id, bundleSha256: hash, state: () => state });
    try {
      await presence.start();
      await run({ id, hash, state, presence, config: expected, base: await custom({ serverConfig: expected }) });
    } finally {
      assert.equal(await presence.stop(), true);
      await pool.query("DELETE FROM worker_presence WHERE fleet_id=$1", [id]);
    }
  }
  async function presenceRow(id: string, hash: string, offsetMs: number, accepting = true): Promise<void> {
    await pool.query(`WITH tick AS (SELECT clock_timestamp()+($4 * INTERVAL '1 millisecond') AS t)
      INSERT INTO worker_presence(instance_id,fleet_id,bundle_sha256,accepting_work,capacity,active_jobs,observed_at,lease_expires_at)
      SELECT $1,$2,$3,$5,1,0,t,t+INTERVAL '15 seconds' FROM tick`, [randomUUID(),id,hash,offsetMs,accepting]);
  }
  try {
    await control("missing bearer denied without DB/probe details", async () => {
      const out = await probe(base); assert.equal(out.response.status, 401); assert.equal(out.body.checks, undefined);
    });
    await control("unknown/customer token denied by actual operator session owner", async () => {
      const out = await probe(base, "coop_sess_customer-or-api-key"); assert.equal(out.response.status, 401);
    });
    await control("viewer operator positive DB/schema/config/graph storage with fleet/index still unready", async () => {
      const out = await probe(base, session.token); assert.equal(out.response.status, 503); assert.equal(out.body.ready, false);
      for (const name of ["database", "schema", "configuration"]) assert.equal(out.body.checks[name].status, "ok", name);
      assert.equal(out.body.checks.graphStorage.status, "ok");
      assert.equal(out.body.checks.graphStorage.reason, "graph_publication_storage_available");
      assert.deepEqual(out.body.checks.graphStorage.publication, { scopes: 0, pending: 0, legacy: 0, unattested: 0, inconsistent: 0 });
      assert.equal(out.body.checks.workers.reason, "worker_fleet_expectations_unconfigured");
      assert.equal(out.body.checks.indexStorage.status, "unverified");
      assert(out.response.headers.get("x-request-id"));
    });
    await control("actual persisted graph and cold API reader expose bounded counts without source or tenant bodies", () => publishedGraph(async () => {
      const out = await probe(base, session.token);
      assert.equal(out.body.checks.graphStorage.status, "ok");
      assert.equal(out.body.checks.graphStorage.publication?.scopes, 1);
      for (const value of ["private-fixture-path", "private-fixture-sha", "private-fixture-author", "synthetic private readiness org", "github:synthetic/readiness"]) assert(!JSON.stringify(out.body).includes(value));
      assert.equal(out.body.ready, false); assert.equal(out.response.status, 503);
    }));
    await control("new queued generation is measured as pending without inventing a current graph or a storage outage", async () => {
      const orgId = randomUUID(); let jobId: string | undefined;
      await pool.query("INSERT INTO organizations(id,name) VALUES($1,'synthetic queued readiness org')", [orgId]);
      try {
        jobId = (await jobs.queue.createJob({ type: JobType.INDEX_REPOSITORY, params: { orgId, repoId: "github:synthetic/pending" }, bypassRateLimit: true })).jobId;
        const out = await probe(base, session.token);
        assert.equal(out.body.checks.graphStorage.status, "ok");
        assert.equal(out.body.checks.graphStorage.publication?.pending, 1);
        assert.equal((await pool.query("SELECT count(*)::int n FROM graph_snapshots WHERE org_id=$1", [orgId])).rows[0].n, 0);
      } finally {
        if (jobId) { await jobs.queue.cancelJob(jobId); await pool.query("DELETE FROM jobs WHERE id=$1", [jobId]); }
        await pool.query("DELETE FROM organizations WHERE id=$1", [orgId]);
      }
    });
    await control("queued successor preserves coherent published graph while reporting per-repository pending freshness", () => publishedGraph(async (_owner, orgId, repoId) => {
      const queued = await jobs.queue.createJob({ type: JobType.INDEX_REPOSITORY, params: { orgId, repoId }, bypassRateLimit: true });
      try {
        const out = await probe(base, session.token);
        assert.equal(out.body.checks.graphStorage.status, "ok"); assert.equal(out.body.checks.graphStorage.publication?.pending, 1);
        assert.equal(out.body.ready, false);
      } finally { await jobs.queue.cancelJob(queued.jobId); await pool.query("DELETE FROM jobs WHERE id=$1", [queued.jobId]); }
    }));
    await control("actual admitted job publication is measured without claiming served-index readiness", () => publishedGraph(async (owner, orgId, repoId) => {
      const queued = await jobs.queue.createJob({ type: JobType.INDEX_REPOSITORY, params: { orgId, repoId }, bypassRateLimit: true });
      try {
        const job = await jobs.queue.claimNext(randomUUID(), 10_000); assert(job); assert.equal(job.id, queued.jobId);
        await owner.publishJobGraph(job, blankRepositoryGraph({ repoId, owner: "synthetic", repo: "readiness", provider: "github" }));
        const out = await probe(base, session.token);
        assert.equal(out.body.checks.graphStorage.status, "ok"); assert.equal(out.body.checks.graphStorage.publication?.pending, 0);
        assert.equal(out.body.checks.indexStorage.status, "unverified"); assert.equal(out.body.ready, false);
        await pool.query("UPDATE graph_publication_heads SET published_job_id=$3 WHERE org_id=$1 AND repo_id=$2", [orgId, repoId, randomUUID()]);
        assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "failed");
        await pool.query("UPDATE graph_publication_heads SET published_job_id=$3 WHERE org_id=$1 AND repo_id=$2", [orgId, repoId, job.id]);
        assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "ok");
      } finally { await jobs.queue.cancelJob(queued.jobId, { includeRunning: true }); await pool.query("DELETE FROM jobs WHERE id=$1", [queued.jobId]); }
    }));
    await control("actual failed job publication cannot be hidden by coherent old durable metadata", () => publishedGraph(async (owner, orgId, repoId) => {
      const queued = await jobs.queue.createJob({ type: JobType.INDEX_REPOSITORY, params: { orgId, repoId }, bypassRateLimit: true });
      await pool.query("CREATE FUNCTION readiness_graph_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic publication fault'; END $$; CREATE TRIGGER readiness_graph_fault BEFORE INSERT OR UPDATE ON graph_snapshots FOR EACH ROW EXECUTE FUNCTION readiness_graph_fault()");
      try {
        const job = await jobs.queue.claimNext(randomUUID(), 10_000); assert(job); assert.equal(job.id, queued.jobId);
        await assert.rejects(owner.publishJobGraph(job, blankRepositoryGraph({ repoId, owner: "synthetic", repo: "readiness", provider: "github" })), /synthetic publication fault/);
        assert.equal(owner.getPersistenceState().failed, false);
        const out = await probe(await custom({ cache: owner }), session.token);
        assert.equal(out.body.checks.graphStorage.status, "failed"); assert.equal(out.body.checks.graphStorage.reason, "graph_persistence_requires_reconciliation");
        assert.equal(out.body.checks.graphStorage.publication?.inconsistent, 0);
      } finally {
        await pool.query("DROP TRIGGER readiness_graph_fault ON graph_snapshots; DROP FUNCTION readiness_graph_fault()");
        await jobs.queue.cancelJob(queued.jobId, { includeRunning: true }); await pool.query("DELETE FROM jobs WHERE id=$1", [queued.jobId]);
      }
    }));
    for (const [label, assignment] of [
      ["stale snapshot", "generation=0"], ["future snapshot", "generation=99"],
      ["wrong revision", "revision=99"], ["wrong origin", "origin='unrecognized-writer'"]
    ]) await control(`actual ${label} metadata fails then restored metadata recovers`, () => publishedGraph(async (_owner, orgId, repoId) => {
      const before = (await pool.query("SELECT generation,revision,origin FROM graph_snapshots WHERE org_id=$1 AND repo_id=$2", [orgId, repoId])).rows[0];
      try {
        await pool.query(`UPDATE graph_snapshots SET ${assignment} WHERE org_id=$1 AND repo_id=$2`, [orgId, repoId]);
        const out = await probe(base, session.token);
        assert.equal(out.body.checks.graphStorage.status, "failed"); assert.equal(out.body.checks.graphStorage.publication?.inconsistent, 1);
      } finally {
        await pool.query("UPDATE graph_snapshots SET generation=$3,revision=$4,origin=$5 WHERE org_id=$1 AND repo_id=$2", [orgId, repoId, before.generation, before.revision, before.origin]);
      }
      assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "ok");
    }));
    await control("missing published snapshot fails and restored snapshot recovers", () => publishedGraph(async (_owner, orgId, repoId) => {
      const row = (await pool.query("DELETE FROM graph_snapshots WHERE org_id=$1 AND repo_id=$2 RETURNING *", [orgId, repoId])).rows[0];
      try { assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "failed"); }
      finally { await pool.query("INSERT INTO graph_snapshots(org_id,repo_id,payload,generation,revision,origin,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [orgId, repoId, row.payload, row.generation, row.revision, row.origin, row.updated_at]); }
      assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "ok");
    }));
    await control("published job pointer must agree with publication origin", () => publishedGraph(async (_owner, orgId, repoId) => {
      await pool.query("UPDATE graph_publication_heads SET published_job_id=$3 WHERE org_id=$1 AND repo_id=$2", [orgId, repoId, randomUUID()]);
      assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "failed");
      await pool.query("UPDATE graph_publication_heads SET published_job_id=NULL WHERE org_id=$1 AND repo_id=$2", [orgId, repoId]);
      assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "ok");
    }));
    await control("zero revision cannot attest a nonzero published generation", () => publishedGraph(async (_owner, orgId, repoId) => {
      await pool.query("UPDATE graph_publication_heads SET revision=0 WHERE org_id=$1 AND repo_id=$2", [orgId, repoId]);
      await pool.query("UPDATE graph_snapshots SET revision=0 WHERE org_id=$1 AND repo_id=$2", [orgId, repoId]);
      assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "failed");
    }));
    await control("database rejects a published head beyond its requested generation", () => publishedGraph(async (_owner, orgId, repoId) => {
      await assert.rejects(pool.query("UPDATE graph_publication_heads SET published_generation=requested_generation+1 WHERE org_id=$1 AND repo_id=$2", [orgId, repoId]), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23514"));
      assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "ok");
    }));
    await control("orphaned snapshot is detected without adopting unknown scope", () => publishedGraph(async (_owner, orgId, repoId) => {
      await pool.query("DELETE FROM graph_publication_heads WHERE org_id=$1 AND repo_id=$2", [orgId, repoId]);
      const out = await probe(base, session.token);
      assert.equal(out.body.checks.graphStorage.status, "failed"); assert.equal(out.body.checks.graphStorage.publication?.inconsistent, 1);
    }));
    await control("purged scope rejects residual graph, accepts clean tombstone and rejects zero-generation deletion", () => publishedGraph(async (_owner, orgId, repoId) => {
      await pool.query("UPDATE graph_publication_heads SET tombstone=true,origin='purge' WHERE org_id=$1 AND repo_id=$2", [orgId, repoId]);
      assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "failed");
      await pool.query("DELETE FROM graph_snapshots WHERE org_id=$1 AND repo_id=$2", [orgId, repoId]);
      assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "ok");
      await pool.query("UPDATE graph_publication_heads SET requested_generation=0,published_generation=0,revision=0 WHERE org_id=$1 AND repo_id=$2", [orgId, repoId]);
      assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "failed");
    }));
    await control("legacy generation remains unattested and is never upgraded by a transport positive", () => publishedGraph(async (_owner, orgId, repoId) => {
      await pool.query("UPDATE graph_publication_heads SET requested_generation=0,published_generation=0,revision=0,origin='legacy-unattested' WHERE org_id=$1 AND repo_id=$2", [orgId, repoId]);
      await pool.query("UPDATE graph_snapshots SET generation=0,revision=0,origin='legacy-unattested' WHERE org_id=$1 AND repo_id=$2", [orgId, repoId]);
      const out = await probe(base, session.token);
      assert.equal(out.body.checks.graphStorage.status, "unverified"); assert.equal(out.body.checks.graphStorage.reason, "legacy_graph_publication_unattested");
      assert.equal(out.body.checks.graphStorage.publication?.legacy, 1);
    }));
    await control("unknown matching writer identity remains unverified", () => publishedGraph(async (_owner, orgId, repoId) => {
      for (const table of ["graph_publication_heads", "graph_snapshots"]) await pool.query(`UPDATE ${table} SET origin='unknown-writer' WHERE org_id=$1 AND repo_id=$2`, [orgId, repoId]);
      const out = await probe(base, session.token);
      assert.equal(out.body.checks.graphStorage.status, "unverified"); assert.equal(out.body.checks.graphStorage.publication?.unattested, 1);
    }));
    await control("closed local cache owner cannot claim healthy storage", () => publishedGraph(async owner => {
      await owner.close();
      const out = await probe(await custom({ cache: owner }), session.token);
      assert.equal(out.body.checks.graphStorage.status, "failed"); assert.equal(out.body.checks.graphStorage.reason, "graph_persistence_requires_reconciliation");
    }));
    await control("failed buffered graph write remains failed while durable metadata is coherent", () => publishedGraph(async (owner, orgId, repoId) => {
      await pool.query("UPDATE graph_publication_heads SET requested_generation=requested_generation+1 WHERE org_id=$1 AND repo_id=$2", [orgId, repoId]);
      owner.setGraph(orgId, blankRepositoryGraph({ repoId, owner: "synthetic", repo: "readiness", provider: "github" }));
      await assert.rejects(owner.flush(), /conflicted/);
      const out = await probe(await custom({ cache: owner }), session.token);
      assert.equal(out.body.checks.graphStorage.status, "failed"); assert.equal(out.body.checks.graphStorage.reason, "graph_persistence_requires_reconciliation");
      assert.equal(out.body.checks.graphStorage.publication?.inconsistent, 0);
    }));
    await control("wrong actual cache pool target is denied even when declared config names the diagnostic DB", async () => {
      for (const options of [{ connectionString: URL.replace("eh02_disposable", "other_database") },
        { connectionString: URL.replace("eh02-disposable-only", "different-synthetic-password") },
        { connectionString: URL, ssl: { rejectUnauthorized: false } }]) {
        const wrong = new Pool(options);
        try {
          const out = await probe(await custom({ cache: new PersistingGraphCache({ pool: wrong }) }), session.token);
          assert.equal(out.body.checks.configuration.status, "failed"); assert.equal(out.body.checks.graphStorage.status, "unverified");
          assert.equal(wrong.totalCount, 0);
        } finally { await wrong.end(); }
      }
    });
    await control("graph-generation column drift fails schema then restored column recovers", async () => {
      await pool.query("ALTER TABLE graph_snapshots RENAME COLUMN revision TO fixture_hidden_revision");
      try { assert.equal((await probe(base, session.token)).body.checks.schema.status, "failed"); }
      finally { await pool.query("ALTER TABLE graph_snapshots RENAME COLUMN fixture_hidden_revision TO revision"); }
      assert.equal((await probe(base, session.token)).body.checks.graphStorage.status, "ok");
    });
    await control("actual ingress missing bearer incomplete length rejects401 before body collection/no diagnostic client", async () => {
      const out = await rawReadiness(base, undefined, "Content-Length: 10\r\n", "x");
      assert.equal(out.status, 401); assert(out.elapsed < 1000); ingressMeasurements.missingBearerPartialLengthMs = out.elapsed;
      assert(!out.response.includes("checks"));
      assert.equal((await pool.query("SELECT count(*)::int count FROM pg_stat_activity WHERE application_name='coop-readiness'")).rows[0].count, 0);
    });
    await control("actual ingress unknown bearer incomplete length remains bounded actual-session401", async () => {
      const out = await rawReadiness(base, "unknown-operator-token", "Content-Length: 10\r\n", "x");
      assert.equal(out.status, 401); assert(out.elapsed < 1800); ingressMeasurements.unknownTokenPartialLengthMs = out.elapsed;
    });
    await control("actual ingress expired session incomplete length rejects401 without waiting for body", async () => {
      const expired = await operatorStore.createSession(String(op.rows[0].id), -1000);
      const out = await rawReadiness(base, expired.token, "Content-Length: 10\r\n", "x");
      assert.equal(out.status, 401); assert(out.elapsed < 1800); ingressMeasurements.expiredSessionPartialLengthMs = out.elapsed;
    });
    await control("actual ingress invalid DB role incomplete length denied by existing role resolver", async () => {
      const constraint = await pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='operators'::regclass AND conname='operators_role_check'");
      assert.equal(constraint.rowCount, 1);
      await pool.query("ALTER TABLE operators DROP CONSTRAINT operators_role_check");
      try {
        await pool.query("UPDATE operators SET role='unsupported_fixture_role' WHERE id=$1", [op.rows[0].id]);
        const out = await rawReadiness(base, session.token, "Content-Length: 10\r\n", "x");
        assert.equal(out.status, 401); assert(out.elapsed < 1800); ingressMeasurements.invalidRolePartialLengthMs = out.elapsed;
      } finally {
        await pool.query("UPDATE operators SET role='viewer' WHERE id=$1", [op.rows[0].id]);
        await pool.query(`ALTER TABLE operators ADD CONSTRAINT operators_role_check ${String(constraint.rows[0].definition)}`);
      }
      assert.equal((await probe(base, session.token)).body.checks.schema.status, "ok");
    });
    await control("actual ingress authorized unexpected complete/incomplete body and chunked body reject400 then close", async () => {
      for (const [framing, body] of [["Content-Length: 1\r\n", "x"], ["Content-Length: 10\r\n", "x"], ["Transfer-Encoding: chunked\r\n", "1\r\nx\r\n"]]) {
        const out = await rawReadiness(base, session.token, framing, body);
        assert.equal(out.status, 400); assert(out.elapsed < 1800); assert(out.response.includes("readiness_body_not_allowed"));
        assert(!out.response.includes("checks")); assert(out.response.includes("connection: close"));
      }
    });
    await control("actual ingress oversized declared body rejects413 for operator/401 without bearer and closes without buffering", async () => {
      const framing = `Content-Length: ${5 * 1024 * 1024 + 1}\r\n`;
      assert.equal((await rawReadiness(base, session.token, framing, "x")).status, 413);
      assert.equal((await rawReadiness(base, undefined, framing, "x")).status, 401);
      assert.equal((await pool.query("SELECT count(*)::int count FROM pg_stat_activity WHERE application_name='coop-readiness'")).rows[0].count, 0);
    });
    await control("actual ingress missing bearer unfinished chunked body denies401/no diagnostic client", async () => {
      const out = await rawReadiness(base, undefined, "Transfer-Encoding: chunked\r\n", "1\r\nx\r\n");
      assert.equal(out.status, 401); assert(out.elapsed < 1000);
      assert.equal((await pool.query("SELECT count(*)::int count FROM pg_stat_activity WHERE application_name='coop-readiness'")).rows[0].count, 0);
    });
    await control("actual ingress zero-length/query positive stays diagnostic503; exact other path retains route behavior", async () => {
      const positive = await rawReadiness(base, session.token, "Content-Length: 0\r\n", "", "/v1/operator/readiness?probe=1");
      assert.equal(positive.status, 503); assert(positive.response.includes('"ready":false')); assert(positive.response.includes('"database":{"status":"ok"}'));
      const other = await rawReadiness(base, session.token, "Content-Length: 0\r\n", "", "/v1/operator/readiness-extra");
      assert.equal(other.status, 404); assert(!other.response.includes("api_dependency_diagnostics"));
      const live = await fetch(`${base}/health`); assert.equal(live.status, 200);
    });
    await control("actual ingress disconnect retains admission until bounded auth SQL settles, then releases without successor work", async () => {
      const lock = await pool.connect(); await lock.query("BEGIN"); await lock.query("LOCK TABLE operator_sessions IN ACCESS EXCLUSIVE MODE");
      const target = new globalThis.URL(base);
      const sockets = Array.from({length:2},()=>connect({host:target.hostname,port:Number(target.port)}));
      for(const socket of sockets) socket.on("error",()=>undefined);
      try {
        for(const socket of sockets) {
          await once(socket,"connect"); socket.write(`GET /v1/operator/readiness HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${session.token}\r\nContent-Length: 10\r\n\r\nx`);
        }
        let pending = 0;
        for(let attempt=0;attempt<30;attempt++) {
          pending = (await pool.query("SELECT count(*)::int count FROM pg_stat_activity WHERE application_name='coop-readiness' AND wait_event_type='Lock'")).rows[0].count;
          if(pending===2) break; await new Promise(done=>setTimeout(done,5));
        }
        assert.equal(pending,2); const start=performance.now(); for(const socket of sockets) socket.destroy();
        const blocked = await probe(base, session.token);
        assert.equal(blocked.body.error,"readiness_unavailable");
        assert(performance.now()-start<300);
        assert((await pool.query("SELECT count(*)::int count FROM pg_stat_activity WHERE application_name='coop-readiness'")).rows[0].count<=2);
        let remaining=2;
        for(let attempt=0;attempt<80;attempt++) {
          remaining=(await pool.query("SELECT count(*)::int count FROM pg_stat_activity WHERE application_name='coop-readiness'")).rows[0].count;
          if(!remaining) break;
          await new Promise(done=>setTimeout(done,10));
        }
        assert.equal(remaining,0);
        ingressMeasurements.disconnectCleanupMs = performance.now()-start;
        assert(ingressMeasurements.disconnectCleanupMs<1000);
      } finally {for(const socket of sockets) socket.destroy();await lock.query("ROLLBACK");lock.release();}
      assert.equal((await probe(base,session.token)).body.checks.schema.status,"ok");
    });
    await control("disabled operator negative then reenabled positive", async () => {
      await pool.query("UPDATE operators SET disabled_at=clock_timestamp() WHERE id=$1", [op.rows[0].id]);
      assert.equal((await probe(base, session.token)).response.status, 401);
      await pool.query("UPDATE operators SET disabled_at=NULL WHERE id=$1", [op.rows[0].id]);
      assert.equal((await probe(base, session.token)).body.checks.schema.status, "ok");
    });
    await control("expired session negative then nonexpired positive", async () => {
      const expired = await operatorStore.createSession(String(op.rows[0].id), -1000);
      assert.equal((await probe(base, expired.token)).response.status, 401);
      assert.equal((await probe(base, session.token)).body.checks.database.status, "ok");
    });
    await control("missing ledger and checksum mismatch fail honestly then recovered", async () => {
      await pool.query("ALTER TABLE schema_migrations RENAME TO schema_migrations_saved");
      try { assert.equal((await probe(base, session.token)).body.error, "readiness_unavailable"); }
      finally { await pool.query("ALTER TABLE schema_migrations_saved RENAME TO schema_migrations"); }
      await pool.query("UPDATE schema_migrations SET checksum='bad' WHERE filename='032_support_reports.sql'");
      try { assert.equal((await probe(base, session.token)).body.checks.schema.reason, "migration_identity_mismatch"); }
      finally { const crypto = await import("node:crypto"); const fs = await import("node:fs"); await pool.query("UPDATE schema_migrations SET checksum=$1 WHERE filename='032_support_reports.sql'", [crypto.createHash("sha256").update(fs.readFileSync(resolve(source,"032_support_reports.sql"))).digest("hex")]); }
      assert.equal((await probe(base, session.token)).body.checks.schema.status, "ok");
    });
    await control("unknown legacy checksum fails; no assumed schema adoption", async () => {
      const old = await pool.query("UPDATE schema_migrations SET checksum=NULL WHERE filename='001_jobs.sql' RETURNING filename"); assert.equal(old.rowCount, 1);
      try { assert.equal((await probe(base, session.token)).body.checks.schema.status, "failed"); }
      finally { const crypto = await import("node:crypto"); const fs = await import("node:fs"); await pool.query("UPDATE schema_migrations SET checksum=$1 WHERE filename='001_jobs.sql'", [crypto.createHash("sha256").update(fs.readFileSync(resolve(source,"001_jobs.sql"))).digest("hex")]); }
    });
    await control("drifted actual column fails despite intact ledger then restored", async () => {
      await pool.query("ALTER TABLE org_credentials RENAME COLUMN encrypted_token TO encrypted_token_saved");
      try { assert.equal((await probe(base, session.token)).body.checks.schema.reason, "required_schema_missing"); }
      finally { await pool.query("ALTER TABLE org_credentials RENAME COLUMN encrypted_token_saved TO encrypted_token"); }
      assert.equal((await probe(base, session.token)).body.checks.schema.status, "ok");
    });
    await control("absent/mutated deployed SQL artifact fails then intact artifact positive", async () => {
      const missingBase = await custom({ migrationsDirectory: resolve(temp, "missing") });
      assert.equal((await probe(missingBase, session.token)).body.checks.schema.reason, "migration_artifact_unavailable");
      cpSync(source, resolve(temp, "migrations"), { recursive: true });
      writeFileSync(resolve(temp, "migrations", "034_job_attempt_leases.sql"), "-- changed deployed artifact");
      const mutatedBase = await custom({ migrationsDirectory: resolve(temp, "migrations") });
      assert.equal((await probe(mutatedBase, session.token)).body.checks.schema.reason, "migration_identity_mismatch");
      assert.equal((await probe(base, session.token)).body.checks.schema.status, "ok");
    });
    await control("runtime key/auth/backend/queue DB mismatch configuration negatives", async () => {
      for (const bad of [
        { serverConfig: { ...serverConfig, credentialsEncryptionKey: undefined } },
        { serverConfig: { ...serverConfig, requireApiAuth: false } },
        { cacheConfig: { ...config.cache, backend: "redis" as const } },
        { cacheConfig: { ...config.cache, backend: "postgres" as const }, cache: new GraphCache() },
        { cacheConfig: { ...config.cache, connectionString: URL.replace("eh02_disposable", "other_database") } },
        { jobs: createJobRuntime({ config: { ...jobs.config, databaseUrl: URL.replace("eh02_disposable", "other_database") }, cache: new GraphCache() }) },
        { jobs: createJobRuntime({ config: { ...jobs.config, backend: "memory" }, cache: new GraphCache() }) }
      ]) {
        try {
          const out = await probe(await custom(bad), session.token);
          assert.equal(out.body.checks.configuration.status, "failed");
        } finally {
          if (bad.jobs) {
            await stopJobRuntime(bad.jobs);
            const backend = bad.jobs.queue.getBackend();
            if ("close" in backend && typeof backend.close === "function") await backend.close();
          }
        }
      }
    });
    await control("memory graph persistence unverified, never declared durable", async () => {
      const out = await probe(await custom({ cache: new GraphCache(), cacheConfig: { ...config.cache, backend: "memory" } }), session.token);
      assert.equal(out.body.checks.graphStorage.status, "unverified"); assert.equal(out.body.ready, false);
    });
    await control("local accepting Boolean never proves remote artifact freshness", async () => {
      const local = await custom({ serverConfig: { ...serverConfig, jobsWorkersEnabled: true } });
      assert.equal((await probe(local, session.token)).body.checks.workers.status, "unverified");
      jobs.workers.start();
      assert.equal((await probe(local, session.token)).body.checks.workers.status, "unverified");
      assert.equal((await probe(local, session.token)).body.ready, false);
      await jobs.workers.stop();
      assert.equal((await probe(local, session.token)).body.checks.workers.status, "unverified");
    });
    await control("fleet configuration rejects malformed identities and guessed fractional counts", async () => {
      for (const bad of [{ COOP_WORKER_FLEET_ID: "" }, { COOP_WORKER_FLEET_ID: "../fleet" },
        { COOP_EXPECTED_WORKER_SHA256: "not-a-build" }, { COOP_MIN_READY_WORKERS: "0" },
        { COOP_MIN_READY_WORKERS: "1.5" }, { COOP_MIN_READY_WORKERS: "Infinity" }]) {
        assert.throws(() => loadServerConfig({ ...env, ...bad }));
      }
      assert.equal(loadServerConfig(env).workerFleetId, undefined);
    });
    await control("configured empty fleet is failed rather than inferred healthy from quiet jobs", async () => {
      const expected = loadServerConfig({ ...env, COOP_WORKER_FLEET_ID: `empty-${randomUUID()}`,
        COOP_EXPECTED_WORKER_SHA256: "a".repeat(64), COOP_MIN_READY_WORKERS: "1" });
      const out = await probe(await custom({ serverConfig: expected }), session.token);
      assert.equal(out.body.checks.workers.status, "failed");
      assert.equal(out.body.checks.workers.reason, "worker_fleet_below_required_presence");
    });
    await control("actual idle presence makes scoped diagnostic positive without a running job", async () => fleet(async ({ id, hash, base }) => {
      const out = await probe(base, session.token);
      assert.equal(out.body.checks.workers.status, "ok");
      assert.deepEqual(out.body.checks.workers.counts, { fresh: 1, incompatible: 0, invalid: 0, minimum: 1 });
      assert.equal(out.body.ready, false);
      const text = JSON.stringify(out.body); assert(!text.includes(id)); assert(!text.includes(hash));
    }));
    await control("wrong expected artifact cannot admit a live worker", async () => fleet(async ({ config: expected }) => {
      const out = await probe(await custom({ serverConfig: { ...expected, expectedWorkerBundleSha256: "b".repeat(64) } }), session.token);
      assert.equal(out.body.checks.workers.reason, "unexpected_worker_artifact");
    }));
    await control("incompatible live artifact cannot hide behind an otherwise sufficient fleet", async () => fleet(async ({ id, base }) => {
      await presenceRow(id, "b".repeat(64), 0);
      const out = await probe(base, session.token);
      assert.equal(out.body.checks.workers.status, "failed");
      assert.equal(out.body.checks.workers.counts?.fresh, 1);
      assert.equal(out.body.checks.workers.counts?.incompatible, 1);
    }));
    await control("explicit minimum worker count is enforced", async () => fleet(async ({ config: expected }) => {
      const out = await probe(await custom({ serverConfig: { ...expected, minimumReadyWorkers: 2 } }), session.token);
      assert.equal(out.body.checks.workers.reason, "worker_fleet_below_required_presence");
    }));
    await control("expired rows do not contribute to required presence", async () => fleet(async ({ id, hash, config: expected }) => {
      await presenceRow(id, hash, -30_000);
      const out = await probe(await custom({ serverConfig: { ...expected, minimumReadyWorkers: 2 } }), session.token);
      assert.equal(out.body.checks.workers.counts?.fresh, 1); assert.equal(out.body.checks.workers.status, "failed");
    }));
    await control("nonaccepting worker withdraws and can renew after recovery", async () => fleet(async ({ state, presence, base }) => {
      state.acceptingWork = false; assert.equal(await presence.refresh(), true);
      assert.equal((await probe(base, session.token)).body.checks.workers.status, "failed");
      state.acceptingWork = true; assert.equal(await presence.refresh(), true);
      assert.equal((await probe(base, session.token)).body.checks.workers.status, "ok");
    }));
    await control("future observed clock cannot become valid presence", async () => fleet(async ({ id, hash, base }) => {
      await presenceRow(id, hash, 30_000);
      assert.equal((await probe(base, session.token)).body.checks.workers.reason, "worker_presence_clock_or_lease_invalid");
    }));
    await control("other fleet identity never supplies missing expected capacity", async () => fleet(async ({ config: expected }) => {
      const out = await probe(await custom({ serverConfig: { ...expected, workerFleetId: `other-${randomUUID()}` } }), session.token);
      assert.equal(out.body.checks.workers.counts?.fresh, 0); assert.equal(out.body.checks.workers.status, "failed");
    }));
    await control("configured local-worker topology remains unverified by dedicated-worker presence", async () => fleet(async ({ config: expected }) => {
      const out = await probe(await custom({ serverConfig: { ...expected, jobsWorkersEnabled: true } }), session.token);
      assert.equal(out.body.checks.workers.reason, "local_worker_artifact_not_registered");
    }));
    await control("actual idle timer renews from database clock", async () => fleet(async ({ id, presence }) => {
      const before = (await pool.query("SELECT observed_at FROM worker_presence WHERE fleet_id=$1", [id])).rows[0].observed_at;
      const deadline = performance.now() + 7_000; let renewed = false;
      while (performance.now() < deadline) {
        const after = (await pool.query("SELECT observed_at FROM worker_presence WHERE fleet_id=$1", [id])).rows[0].observed_at;
        if (after.getTime() > before.getTime()) { renewed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(renewed); assert(presence.fresh);
    }));
    await control("bounded stale metadata cleanup stays in its own fleet", async () => fleet(async ({ id, hash, presence }) => {
      const foreign = `other-${randomUUID()}`;
      try {
        await presenceRow(id, hash, -2 * 86_400_000); await presenceRow(foreign, hash, -2 * 86_400_000);
        assert.equal(await presence.refresh(), true);
        assert.equal((await pool.query("SELECT COUNT(*)::int n FROM worker_presence WHERE fleet_id=$1", [id])).rows[0].n, 1);
        assert.equal((await pool.query("SELECT COUNT(*)::int n FROM worker_presence WHERE fleet_id=$1", [foreign])).rows[0].n, 1);
      } finally { await pool.query("DELETE FROM worker_presence WHERE fleet_id=$1", [foreign]); }
    }));
    await control("presence renewal lock failure is bounded and recovers without overlapping writes", async () => fleet(async ({ presence }) => {
      const lock = await pool.connect(); await lock.query("BEGIN"); await lock.query("LOCK TABLE worker_presence IN ACCESS EXCLUSIVE MODE");
      try {
        const started = performance.now();
        assert.deepEqual(await Promise.all([presence.refresh(), presence.refresh()]), [false, false]);
        assert(performance.now() - started < 1_500); assert.equal(presence.fresh, false);
      } finally { await lock.query("ROLLBACK"); lock.release(); }
      assert.equal(await presence.refresh(), true); assert(presence.fresh);
    }));
    await control("presence shutdown is idempotent and retires exact owned row", async () => fleet(async ({ id, presence, base }) => {
      assert.equal(await presence.stop(), true); assert.equal(await presence.stop(), true);
      assert.equal(await presence.refresh(), false);
      assert.equal((await pool.query("SELECT COUNT(*)::int n FROM worker_presence WHERE fleet_id=$1", [id])).rows[0].n, 0);
      assert.equal((await probe(base, session.token)).body.checks.workers.status, "failed");
    }));
    await control("blocked auth/concurrent saturation bounded; public liveness preserved; clients terminated", async () => {
      const lock = await pool.connect(); await lock.query("BEGIN"); await lock.query("LOCK TABLE operator_sessions IN ACCESS EXCLUSIVE MODE");
      try {
        const started = performance.now();
        const pending = Array.from({ length: 12 }, () => probe(base, session.token));
        await new Promise(done => setTimeout(done, 100));
        const pg = await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='coop-readiness'");
        assert(pg.rows[0].count <= 2);
        const live = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) }); assert.equal(live.status, 200); const liveBody: unknown = await live.json(); assert(liveBody && typeof liveBody === "object" && "ok" in liveBody); assert.equal(liveBody.ok, true);
        const results = await Promise.all(pending); assert(results.every(out => out.response.status === 503));
        assert(performance.now() - started < 2500);
      } finally { await lock.query("ROLLBACK"); lock.release(); }
      await new Promise(done => setTimeout(done, 100));
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='coop-readiness'")).rows[0].count, 0);
      assert.equal((await probe(base, session.token)).body.checks.schema.status, "ok");
    });
    await control("real required table-lock timeout fails then released positive", async () => {
      const lock = await pool.connect(); await lock.query("BEGIN"); await lock.query("LOCK TABLE repo_symbol_index IN ACCESS EXCLUSIVE MODE");
      try { assert.equal((await probe(base, session.token)).body.error, "readiness_unavailable"); }
      finally { await lock.query("ROLLBACK"); lock.release(); }
      assert.equal((await probe(base, session.token)).body.checks.schema.status, "ok");
    });
    await control("TCP connects but vendor-less PG handshake stalls: bounded cleanup and subsequent admission", async () => {
      const sockets = new Set<import("node:net").Socket>();
      const tcp = createTcpServer(socket => { sockets.add(socket); socket.resume(); socket.on("close", () => sockets.delete(socket)); });
      tcp.listen(0, "127.0.0.1"); await once(tcp, "listening"); const address = tcp.address(); assert(address && typeof address === "object");
      const hung = await custom({ databaseUrl: fixtureWithPort(address.port) });
      try {
        for (let i=0;i<3;i++) { const started = performance.now(); assert.equal((await probe(hung, session.token)).response.status, 503); assert(performance.now()-started<2000); }
        await new Promise(done => setTimeout(done, 100)); assert.equal(sockets.size, 0);
      } finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(done => tcp.close(() => done())); }
    });
    await control("overall socket deadline cancels real PG query whose completed response is withheld", async () => {
      const downstream = new Set<import("node:net").Socket>();
      let held = false;
      const proxy = createTcpServer(socket => {
        downstream.add(socket);
        const upstream = connect({ host:"127.0.0.1",port:fixturePort });
        let requestTail=Buffer.alloc(0);
        socket.on("data",chunk=>{
          requestTail=Buffer.concat([requestTail,chunk]).subarray(-4096);
          if(requestTail.includes(Buffer.from("FROM operator_sessions"))) held=true;
          upstream.write(chunk);
        });
        upstream.on("data",chunk=>{if(!held) socket.write(chunk);});
        socket.on("error",()=>upstream.destroy()); upstream.on("error",()=>socket.destroy());
        socket.on("close",()=>{downstream.delete(socket);upstream.destroy();});
        upstream.on("close",()=>socket.destroy());
      });
      proxy.listen(0,"127.0.0.1"); await once(proxy,"listening"); const address=proxy.address(); assert(address && typeof address==="object");
      const proxied=await custom({databaseUrl:fixtureWithPort(address.port)});
      try {
        const start=performance.now(); const result=await probe(proxied,session.token); const elapsed=performance.now()-start;
        assert(held); assert.equal(result.response.status,503); assert.equal(result.body.error,"readiness_unavailable");
        assert(elapsed>=1200 && elapsed<2300,`deadline elapsed ${elapsed}`);
        await new Promise(done=>setTimeout(done,100)); assert.equal(downstream.size,0);
        assert.equal((await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name='coop-readiness'")).rows[0].count,0);
      } finally {for(const socket of downstream) socket.destroy(); await new Promise<void>(done=>proxy.close(()=>done()));}
    });
    await control("missing/malformed DB configuration sanitized without connections", async () => {
      for (const databaseUrl of [undefined, "not-a-dsn-with-private-secret"]) {
        const out = await probe(await custom({ databaseUrl }), session.token);
        assert.equal(out.response.status, 503); assert.equal(out.body.checks, undefined);
        assert(!JSON.stringify(out.body).includes("private-secret"));
      }
    });
    await control("readiness close cancels outstanding authenticated query and denies subsequent work", async () => {
      const lock = await pool.connect(); await lock.query("BEGIN"); await lock.query("LOCK TABLE operator_sessions IN ACCESS EXCLUSIVE MODE");
      const owner = new OperatorReadiness({ databaseUrl: URL, serverConfig, cacheConfig: config.cache, cache, jobs });
      const server = createServer(async (req,res) => owner.handle({ authorization: req.headers.authorization },res));
      children.push(server); diagnosticOwners.push(owner); const ownBase = await listen(server);
      try {
        const waiting = probe(ownBase, session.token); await new Promise(done=>setTimeout(done,100)); owner.close();
        assert.equal((await waiting).response.status,503); assert.equal((await probe(ownBase,session.token)).response.status,503);
      } finally { await lock.query("ROLLBACK"); lock.release(); }
    });
    console.log(JSON.stringify({ suite: "EH11-owned-HTTP-PG", completed, controls, ingressMeasurements, providerCalls: 0, fullReadinessQualified: false }));
  } finally {
    for (const owner of diagnosticOwners) owner.close();
    for (const server of children) await close(server);
    api.kill("SIGTERM"); await once(api,"exit"); await stopJobRuntime(jobs); const backend = jobs.queue.getBackend(); if ("close" in backend && typeof backend.close === "function") await backend.close();
    await pool.end(); rmSync(temp, { recursive:true,force:true });
  }
});
