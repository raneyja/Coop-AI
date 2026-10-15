import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import databasePoolOptions from "../databasePoolOptions.cjs";
import { AuthRateLimitStore, consumeAuthRequest } from "./authRateLimit";
import { handleUserAuthApiRequest, type UserAuthApiDeps } from "./userAuthApi";
import { loadAuthConfig } from "./authConfig";
import { handleBillingApiRequest } from "../billing/billingApi";
import type { ServerConfig } from "../serverConfig";

const { publicationDatabaseFromEnvironment } = require("../../../scripts/publication-test-fixture.mjs");
const { runMigrations } = require("../../../scripts/run-migrations.mjs");
// Admits actual current Docker identity, owner, cached image, loopback/tmpfs and no ambient overrides before Pool.
const database: string = publicationDatabaseFromEnvironment(process.env, 'auth');
const production: ServerConfig = { nodeEnv: "production", devMode: true, requireApiAuth: true, jobsWorkersEnabled: false };

test("shared auth counters and actual two-server HTTP admission in a newly owned disposable PostgreSQL", async t => {
  const pool1 = new Pool({ ...databasePoolOptions(database), max: 4, connectionTimeoutMillis: 1000, application_name: "eh03-auth-rate-one" });
  const pool2 = new Pool({ ...databasePoolOptions(database), max: 4, connectionTimeoutMillis: 1000, application_name: "eh03-auth-rate-two" });
  const servers: Server[] = [];
  const reset = () => pool1.query("DELETE FROM public.auth_rate_limits");
  try {
    const dir = mkdtempSync(join(tmpdir(), "coop-auth-rate-migration-"));
    copyFileSync(join(process.cwd(), "migrations/039_auth_rate_limits.sql"), join(dir, "039_auth_rate_limits.sql"));
    assert.equal((await pool1.query("SELECT to_regclass('public.schema_migrations') AS existing")).rows[0].existing, null);
    await runMigrations({ databaseUrl: database, migrationsDir: dir, log: () => undefined });
    const store1 = new AuthRateLimitStore(pool1), store2 = new AuthRateLimitStore(pool2);
    await t.test("two independent store instances enforce one exact 20-attempt budget under 30 concurrent requests", async () => {
      const results = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? store1 : store2).consume("192.0.2.1")));
      assert.equal(results.filter(Boolean).length, 20);
      const row = (await pool1.query("SELECT attempts, key_hash FROM public.auth_rate_limits")).rows[0];
      assert.equal(row.attempts, 21); assert.match(row.key_hash, /^[0-9a-f]{64}$/); assert.ok(!row.key_hash.includes("192.0.2.1"));
    });
    await t.test("separate source peers have independent budgets", async () => {
      assert.equal(await store2.consume("198.51.100.1"), true);
      assert.equal(await store1.consume("192.0.2.1"), false);
    });
    await t.test("fixed windows expire using real PostgreSQL time", async () => {
      await reset(); const short1 = new AuthRateLimitStore(pool1, { max: 1, windowMs: 100 });
      const short2 = new AuthRateLimitStore(pool2, { max: 1, windowMs: 100 });
      assert.equal(await short1.consume("192.0.2.1"), true); assert.equal(await short2.consume("192.0.2.1"), false);
      await pool2.query("SELECT pg_sleep(0.15)"); assert.equal(await short2.consume("192.0.2.1"), true);
    });
    await t.test("window admission observes fresh database time after a real cross-client lock wait", async () => {
      await reset(); const short = new AuthRateLimitStore(pool1, { max: 1, windowMs: 150 });
      assert.equal(await short.consume("192.0.2.1"), true);
      const blocker = await pool2.connect();
      try {
        await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(19803403, 39)");
        const pending = short.consume("192.0.2.1"); await delay(200); await blocker.query("COMMIT");
        assert.equal(await pending, true);
      } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    });
    await t.test("hard bucket cap denies new peers, preserves existing counters and reclaims expired capacity", async () => {
      await reset(); const capped = new AuthRateLimitStore(pool1, { max: 2, maxBuckets: 2 });
      assert.equal(await capped.consume("192.0.2.1"), true); assert.equal(await capped.consume("192.0.2.2"), true);
      assert.equal(await capped.consume("192.0.2.3"), false); assert.equal(await capped.consume("192.0.2.1"), true);
      assert.equal((await pool1.query("SELECT COUNT(*)::integer AS count FROM public.auth_rate_limits")).rows[0].count, 2);
      await pool1.query("UPDATE public.auth_rate_limits SET reset_at = clock_timestamp() - INTERVAL '1 second'");
      assert.equal(await capped.consume("192.0.2.3"), true);
    });
    const bases: string[] = [];
    for (const store of [store1, store2, undefined]) {
      const deps: UserAuthApiDeps = { orgStore: {} as never, userStore: { findActiveUserByEmail: async () => undefined } as never,
        authIdentityStore: {} as never, authTokenStore: {} as never, authConfig: loadAuthConfig({}), serverConfig: production, authRateLimitStore: store };
      const server = createServer(async (request, response) => {
        let raw = ""; for await (const chunk of request) raw += chunk;
        try {
          const parsed = { method: request.method!, pathname: request.url!,
            headers: { "x-forwarded-for": String(request.headers["x-forwarded-for"] ?? ""), "x-real-ip": String(request.headers["x-real-ip"] ?? "") },
            body: raw ? JSON.parse(raw) : {}, peerAddress: request.socket.remoteAddress };
          if (!(await handleUserAuthApiRequest(parsed, response, deps))) {
            await handleBillingApiRequest({ ...parsed, rawBody: Buffer.from(raw) }, response, { ...deps, emailService: {} as never, pool: pool1 });
          }
        } catch { response.writeHead(500); response.end(); }
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); servers.push(server);
      const address = server.address(); assert.ok(address && typeof address === "object"); bases.push(`http://127.0.0.1:${address.port}`);
    }
    const attempt = async (i: number, path = "/v1/auth/login") => {
      const response = await fetch(bases[i % 2]! + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${i + 1}`, "x-real-ip": `203.0.113.${i + 1}` },
        body: JSON.stringify({ email: `rotating-${i}@fixture.invalid`, password: "password", token: `rotating-${i}` }), signal: AbortSignal.timeout(3000) });
      const text = await response.text(); return { status: response.status, text };
    };
    await t.test("actual HTTP replicas cannot bypass the peer budget by rotating email or spoofing XFF/real-IP", async () => {
      await reset();
      for (let i = 0; i < 20; i++) assert.equal((await attempt(i)).status, 401);
      assert.equal((await attempt(20)).status, 429);
      assert.equal((await pool1.query("SELECT COUNT(*)::integer AS count FROM public.auth_rate_limits")).rows[0].count, 1);
    });
    await t.test("register/login/forgot/reset share an independent peer counter before their side effects", async () => {
      for (const path of ["/v1/auth/register", "/v1/auth/forgot-password", "/v1/auth/reset-password", "/v1/signup/free"]) assert.equal((await attempt(21, path)).status, 429);
    });
    await t.test("database outage returns a bounded plain 503 without memory fallback even in production devMode", async () => {
      await pool1.query("ALTER TABLE public.auth_rate_limits RENAME TO auth_rate_limits_held");
      try {
        const response = await attempt(22); assert.equal(response.status, 503);
        assert.doesNotMatch(response.text, /relation|auth_rate_limits|postgres|rotating-/i);
      } finally { await pool1.query("ALTER TABLE public.auth_rate_limits_held RENAME TO auth_rate_limits"); }
    });
    await t.test("production without shared state or socket identity is denied", async () => {
      await assert.rejects(consumeAuthRequest({ headers: {}, peerAddress: "127.0.0.1", serverConfig: production }), /unavailable/);
      await assert.rejects(consumeAuthRequest({ headers: { "x-forwarded-for": "127.0.0.1" }, serverConfig: production, authRateLimitStore: store1 }), /unavailable/);
    });
    await t.test("production HTTP without the shared store refuses before account lookup", async () => {
      const response = await fetch(bases[2]! + "/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "no-store@fixture.invalid", password: "password" }), signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 503); assert.equal((await response.json() as { error: string }).error, "auth_unavailable");
    });
    await t.test("a pool checkout arriving after the 1500ms deadline is released without consuming", async () => {
      await reset(); const latePool = new Pool({ ...databasePoolOptions(database), max: 1, application_name: "eh03-auth-rate-late-checkout" });
      const held = await latePool.connect(); let heldReleased = false;
      try {
        await assert.rejects(new AuthRateLimitStore(latePool).consume("192.0.2.5"), /unavailable/);
        held.release(); heldReleased = true;
        for (let i = 0; i < 100 && (latePool.waitingCount || latePool.idleCount !== 1); i++) await delay(5);
        assert.equal(latePool.waitingCount, 0); assert.equal(latePool.idleCount, 1);
        assert.equal((await pool1.query("SELECT COUNT(*)::integer AS count FROM public.auth_rate_limits")).rows[0].count, 0);
      } finally { if (!heldReleased) held.release(); await latePool.end(); }
    });
    await t.test("real deferred constraint failure at COMMIT rolls back the attempt and releases its client", async () => {
      await reset();
      await pool1.query("CREATE TABLE public.auth_rate_commit_control (key_hash TEXT PRIMARY KEY)");
      await pool1.query("ALTER TABLE public.auth_rate_limits ADD CONSTRAINT auth_rate_commit_control_fk FOREIGN KEY (key_hash) REFERENCES public.auth_rate_commit_control(key_hash) DEFERRABLE INITIALLY DEFERRED");
      try {
        await assert.rejects(store1.consume("192.0.2.6"), /unavailable/);
        assert.equal((await pool1.query("SELECT COUNT(*)::integer AS count FROM public.auth_rate_limits")).rows[0].count, 0);
        assert.equal(pool1.totalCount, pool1.idleCount);
      } finally {
        await pool1.query("ALTER TABLE public.auth_rate_limits DROP CONSTRAINT auth_rate_commit_control_fk");
        await pool1.query("DROP TABLE public.auth_rate_commit_control");
      }
      assert.equal(await store2.consume("192.0.2.6"), true);
    });
    await t.test("deadline destroys the owned real transaction and no delayed COMMIT can publish a counter", async () => {
      await reset();
      const timedPool = new Pool({ ...databasePoolOptions(database), max: 1, application_name: "eh03-auth-rate-deadline" });
      const originalConnect = timedPool.connect.bind(timedPool); let releases = 0;
      timedPool.connect = (async () => {
        const client = await originalConnect(); const query = client.query.bind(client); const release = client.release.bind(client);
        client.query = (async (...args: Parameters<typeof client.query>) => {
          if (args[0] === "COMMIT") await delay(1600);
          return query(...args);
        }) as typeof client.query;
        client.release = error => { releases++; release(error); };
        return client;
      }) as typeof timedPool.connect;
      try {
        await assert.rejects(new AuthRateLimitStore(timedPool).consume("192.0.2.7"), /unavailable/);
        await delay(200);
        assert.equal(releases, 1); assert.equal(timedPool.totalCount, 0);
        assert.equal((await pool1.query("SELECT COUNT(*)::integer AS count FROM public.auth_rate_limits")).rows[0].count, 0);
      } finally { await timedPool.end(); }
      assert.equal(await store2.consume("192.0.2.7"), true);
    });
    await t.test("actual held lock is bounded, rolls back and releases all leased pool clients", async () => {
      const blocker = await pool2.connect();
      try {
        await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(19803403, 39)");
        const start = performance.now(); await assert.rejects(store1.consume("192.0.2.4"), /unavailable/);
        assert.ok(performance.now() - start < 2000);
      } finally { await blocker.query("ROLLBACK"); blocker.release(); }
      assert.equal(await store1.consume("192.0.2.4"), true); assert.equal(pool1.waitingCount, 0); assert.equal(pool1.totalCount, pool1.idleCount);
    });
    await t.test("migration rerun preserves the applied ledger and live counters", async () => {
      const before = (await pool1.query("SELECT COUNT(*)::integer AS count FROM public.auth_rate_limits")).rows[0].count;
      await runMigrations({ databaseUrl: database, migrationsDir: dir, log: () => undefined });
      assert.equal((await pool1.query("SELECT COUNT(*)::integer AS count FROM public.auth_rate_limits")).rows[0].count, before);
    });
  } finally {
    for (const server of servers) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    await pool1.end(); await pool2.end();
  }
});
