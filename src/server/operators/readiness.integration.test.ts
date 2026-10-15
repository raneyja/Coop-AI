// Fresh suite-bound actual Docker admission must precede all database constructors.
const {publicationDatabaseFromEnvironment} = require('../../../scripts/publication-test-fixture.mjs');
const releaseDatabase: string = publicationDatabaseFromEnvironment(process.env, 'readiness');
import assert from "node:assert/strict";
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
import { GraphCache } from "../../cache/graphCache";
import { PersistingGraphCache } from "../../cache/graphCachePostgres";
import { loadJobQueueConfig } from "../../config/jobQueueConfig";
import { loadWebhookConfig } from "../../config/webhookConfig";
import { createJobRuntime, stopJobRuntime } from "../../jobs/jobRuntime";
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
  GRAPH_CACHE_BACKEND: "postgres", CREDENTIALS_ENCRYPTION_KEY: "synthetic-readiness-key"
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
  const body = decoded as { error?: string; ready?: boolean; checks: Record<string, { status: string; reason?: string }> };
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
  try {
    await control("missing bearer denied without DB/probe details", async () => {
      const out = await probe(base); assert.equal(out.response.status, 401); assert.equal(out.body.checks, undefined);
    });
    await control("unknown/customer token denied by actual operator session owner", async () => {
      const out = await probe(base, "coop_sess_customer-or-api-key"); assert.equal(out.response.status, 401);
    });
    await control("viewer operator positive DB/schema/config with required cache/fleet/index unready", async () => {
      const out = await probe(base, session.token); assert.equal(out.response.status, 503); assert.equal(out.body.ready, false);
      for (const name of ["database", "schema", "configuration"]) assert.equal(out.body.checks[name].status, "ok", name);
      assert.equal(out.body.checks.graphStorage.reason, "buffered_cache_publication_freshness_contract_missing");
      assert.equal(out.body.checks.workers.reason, "remote_fleet_freshness_contract_missing");
      assert.equal(out.body.checks.indexStorage.status, "unverified");
      assert(out.response.headers.get("x-request-id"));
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
    await control("actual local worker stopped/running/stopped acceptance with index still unready", async () => {
      const local = await custom({ serverConfig: { ...serverConfig, jobsWorkersEnabled: true } });
      assert.equal((await probe(local, session.token)).body.checks.workers.status, "failed");
      jobs.workers.start();
      assert.equal((await probe(local, session.token)).body.checks.workers.status, "ok");
      assert.equal((await probe(local, session.token)).body.ready, false);
      await jobs.workers.stop();
      assert.equal((await probe(local, session.token)).body.checks.workers.status, "failed");
    });
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
