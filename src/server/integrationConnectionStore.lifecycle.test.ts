// Fresh suite-bound actual Docker admission must precede all database constructors.
const {publicationDatabaseFromEnvironment} = require('../../scripts/publication-test-fixture.mjs');
const releaseDatabase: string = publicationDatabaseFromEnvironment(process.env, 'integration-store');
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Pool } from "pg";
import databasePoolOptions from "./databasePoolOptions.cjs";
import { IntegrationConnectionStore, type IntegrationProvider } from "./integrationConnectionStore";

const { admitDisposableDatabaseTarget } = require("../../scripts/disposable-database-target.mjs") as {
  admitDisposableDatabaseTarget(url: string, fixture: { port: string; database: string; user: string }): string;
};
const { runMigrations } = require("../../scripts/run-migrations.mjs") as {
  runMigrations(options: { databaseUrl: string; migrationsDir: string; log: (message: string) => void }): Promise<void>;
};
const DATABASE = releaseDatabase;
const KEY = "eh02-owned-synthetic-encryption-key";
const providers: IntegrationProvider[] = ["slack", "atlassian", "notion", "google-docs", "teams"];
const pool = (name: string) => new Pool({ ...databasePoolOptions(DATABASE), max: 1, application_name: name,
  connectionTimeoutMillis: 1_000, statement_timeout: 2_000, lock_timeout: 1_000 });

test("actual encrypted integration store generation and refresh lifecycle", async t => {
  const a = pool("eh02-store-a"), b = pool("eh02-store-b"), locks = pool("eh02-store-lock");
  const storeA = new IntegrationConnectionStore(a, KEY), storeB = new IntegrationConnectionStore(b, KEY);
  const baseline = mkdtempSync(resolve(tmpdir(), "eh02-store-migrations-"));
  const orgs: string[] = [], controls: string[] = [];
  async function control(name: string, fn: () => Promise<void>) { await t.test(name, fn); controls.push(name); }
  async function raw(orgId: string, provider: IntegrationProvider) {
    return (await a.query("SELECT * FROM org_integration_connections WHERE org_id=$1 AND provider=$2", [orgId, provider])).rows[0];
  }
  async function admitted(orgId: string, provider: IntegrationProvider) {
    const record = await storeA.get(orgId, provider); assert(record); return record;
  }
  try {
    const identity = (await a.query("SELECT current_database() AS db,current_user AS usr,version() AS version")).rows[0];
    assert.equal(identity.db, "eh02_disposable"); assert.equal(identity.usr, "eh02");
    assert.equal((await a.query("SELECT to_regclass('public.schema_migrations') AS ledger")).rows[0].ledger, null,
      "Use a fresh owned fixture; never drop or silently reuse an unknown schema");
    for (const name of readdirSync(resolve("migrations"))) {
      if (/^0(?:0\d|[12]\d|3[0-2])_.*\.sql$/.test(name)) cpSync(resolve("migrations", name), resolve(baseline, name));
    }
    assert.equal(readdirSync(baseline).length, 32);
    await runMigrations({ databaseUrl: DATABASE, migrationsDir: baseline, log: () => undefined });
    for (const suffix of ["A", "B"]) {
      orgs.push(String((await a.query("INSERT INTO organizations(name) VALUES ($1) RETURNING id", [`EH02 synthetic ${suffix}`])).rows[0].id));
    }
    const [orgA, orgB] = orgs;
    // Exercise the unchanged legacy INSERT path before the additive migration.
    await storeA.upsert(orgA, "slack", "legacy-access-A", { refreshToken: "legacy-refresh-A", botAccessToken: "legacy-bot-A",
      expiresAt: new Date(0), metadata: { teamId: "synthetic-team", teamName: "Synthetic fixture" } });
    await storeB.upsert(orgB, "slack", "legacy-access-B", { refreshToken: "legacy-refresh-B" });
    const encryptedBefore = await raw(orgA, "slack");
    await runMigrations({ databaseUrl: DATABASE, migrationsDir: resolve("migrations"), log: () => undefined });

    await control("legacy rows receive distinct durable revisions without changing encrypted credentials", async () => {
      const first = await admitted(orgA, "slack"), second = await admitted(orgB, "slack");
      assert.match(first.revision, /^[a-f0-9-]{36}$/); assert.notEqual(first.revision, second.revision);
      const after = await raw(orgA, "slack");
      for (const field of ["encrypted_access_token", "encrypted_refresh_token", "metadata", "token_expires_at", "updated_at"])
        assert.deepEqual(after[field], encryptedBefore[field]);
      assert.equal(await storeA.getAccessToken(orgA, "slack", first.revision), "legacy-access-A");
      assert.equal(await storeA.getRefreshToken(orgA, "slack", first.revision), "legacy-refresh-A");
      assert.equal(await storeA.getBotAccessToken(orgA, "slack"), "legacy-bot-A");
      assert.notEqual(after.encrypted_access_token, "legacy-access-A");
    });
    await control("current refresh is encrypted, changes generation and fences both old token reads", async () => {
      const first = await admitted(orgA, "slack"), expiry = new Date(Date.now() + 3_600_000);
      assert.equal(await storeA.saveRefreshedTokens(orgA, "slack", first.revision, "new-access", { refreshToken: "new-refresh", expiresAt: expiry }), true);
      const next = await admitted(orgA, "slack"); assert.notEqual(next.revision, first.revision);
      assert.equal(next.tokenExpiresAt?.getTime(), expiry.getTime());
      assert.equal(await storeA.getAccessToken(orgA, "slack", first.revision), undefined);
      assert.equal(await storeA.getRefreshToken(orgA, "slack", first.revision), undefined);
      assert.equal(await storeA.getAccessToken(orgA, "slack", next.revision), "new-access");
      assert.equal(await storeA.getRefreshToken(orgA, "slack", next.revision), "new-refresh");
      const row = await raw(orgA, "slack"); assert.notEqual(row.encrypted_access_token, "new-access"); assert.notEqual(row.encrypted_refresh_token, "new-refresh");
    });
    await control("omitted refresh replacement preserves its exact ciphertext and all raw metadata including bot token", async () => {
      await a.query("UPDATE org_integration_connections SET metadata=metadata || '{\"futureVendorField\":\"synthetic-opaque-value\"}'::jsonb WHERE org_id=$1 AND provider='slack'", [orgA]);
      const record = await admitted(orgA, "slack"), before = await raw(orgA, "slack");
      assert.equal(await storeA.saveRefreshedTokens(orgA, "slack", record.revision, "access-with-omitted-refresh"), true);
      const after = await raw(orgA, "slack"), next = await admitted(orgA, "slack");
      assert.equal(after.encrypted_refresh_token, before.encrypted_refresh_token); assert.deepEqual(after.metadata, before.metadata);
      assert.equal(await storeA.getRefreshToken(orgA, "slack", next.revision), "new-refresh");
      assert.equal(await storeA.getBotAccessToken(orgA, "slack"), "legacy-bot-A");
      assert.equal(after.token_expires_at, null, "Omitted expiry is unknown for the new token, matching previous refresh semantics");
    });
    for (const provider of providers) await control(`${provider} current refresh and legacy optional token reads remain compatible`, async () => {
      await storeA.upsert(orgA, provider, "provider-old-access", { refreshToken: "provider-old-refresh", metadata: { displayName: "Synthetic provider" } });
      const first = await admitted(orgA, provider), metadata = (await raw(orgA, provider)).metadata;
      assert.equal(await storeA.saveRefreshedTokens(orgA, provider, first.revision, " provider-new-access ", { refreshToken: " provider-new-refresh " }), true);
      const next = await admitted(orgA, provider); assert.notEqual(next.revision, first.revision);
      assert.equal(await storeA.getAccessToken(orgA, provider), "provider-new-access");
      assert.equal(await storeA.getRefreshToken(orgA, provider), "provider-new-refresh");
      assert.deepEqual((await raw(orgA, provider)).metadata, metadata);
    });
    await control("acknowledged store delete prevents a delayed captured refresh from recreating a row", async () => {
      const old = await admitted(orgA, "slack");
      await storeB.delete(orgA, "slack"); assert.equal(await storeA.get(orgA, "slack"), undefined);
      assert.equal(await storeA.saveRefreshedTokens(orgA, "slack", old.revision, "stale-after-disconnect", { refreshToken: "stale-refresh" }), false);
      assert.equal(await storeA.get(orgA, "slack"), undefined); assert.equal(await raw(orgA, "slack"), undefined);
    });
    await control("disconnect and reconnect before delayed refresh leaves the replacement byte-for-byte intact", async () => {
      await storeA.upsert(orgA, "slack", "pre-disconnect", { refreshToken: "pre-refresh" });
      const captured = await admitted(orgA, "slack");
      await storeB.delete(orgA, "slack");
      await storeB.upsert(orgA, "slack", "reconnected-access", { refreshToken: "reconnected-refresh", botAccessToken: "reconnected-bot",
        metadata: { teamId: "new-installation", teamName: "Replacement synthetic team" } });
      const replacement = await raw(orgA, "slack"); assert.notEqual(replacement.revision, captured.revision);
      assert.equal(await storeA.saveRefreshedTokens(orgA, "slack", captured.revision, "stale-completion", { refreshToken: "stale-rotation" }), false);
      assert.deepEqual(await raw(orgA, "slack"), replacement);
      assert.equal(await storeA.getAccessToken(orgA, "slack", captured.revision), undefined);
      assert.equal(await storeA.getRefreshToken(orgA, "slack", captured.revision), undefined);
      assert.equal(await storeA.getAccessToken(orgA, "slack", replacement.revision), "reconnected-access");
      assert.equal(await storeA.getBotAccessToken(orgA, "slack"), "reconnected-bot");
    });
    await control("two actual database clients blocked on one captured generation permit exactly one refresh commit", async () => {
      const captured = await admitted(orgA, "slack"), lock = await locks.connect();
      const pidA = (await a.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const pidB = (await b.query("SELECT pg_backend_pid() AS pid")).rows[0].pid; assert.notEqual(pidA, pidB);
      let pending: Promise<boolean[]> | undefined;
      try {
        await lock.query("BEGIN"); await lock.query("SELECT 1 FROM org_integration_connections WHERE org_id=$1 AND provider='slack' FOR UPDATE", [orgA]);
        pending = Promise.all([
          storeA.saveRefreshedTokens(orgA, "slack", captured.revision, "contender-A", { refreshToken: "rotation-A" }),
          storeB.saveRefreshedTokens(orgA, "slack", captured.revision, "contender-B", { refreshToken: "rotation-B" })
        ]);
        let blocked = false;
        for (let i = 0; i < 50; i++) {
          const waiting = await lock.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'", [[pidA, pidB]]);
          if (waiting.rows[0].n === 2) { blocked = true; break; } await delay(10);
        }
        assert(blocked, "Both actual independent SQL updates must contend before release");
        await lock.query("COMMIT");
        const results = await pending; assert.equal(results.filter(Boolean).length, 1);
        const current = await admitted(orgA, "slack"), winner = results[0] ? "A" : "B";
        assert.notEqual(current.revision, captured.revision);
        assert.equal(await storeA.getAccessToken(orgA, "slack", current.revision), `contender-${winner}`);
        assert.equal(await storeA.getRefreshToken(orgA, "slack", current.revision), `rotation-${winner}`);
        const before = await raw(orgA, "slack");
        assert.equal(await storeB.saveRefreshedTokens(orgA, "slack", captured.revision, "late-loser"), false);
        assert.deepEqual(await raw(orgA, "slack"), before);
      } finally { await lock.query("ROLLBACK"); lock.release(); await pending?.catch(() => undefined); }
    });
    await control("every legacy upsert and even no-op SQL update changes revision independently of timestamp precision", async () => {
      const first = await admitted(orgA, "slack");
      await storeB.upsert(orgA, "slack", "legacy-overwrite", { refreshToken: "legacy-replacement" });
      const second = await admitted(orgA, "slack"); assert.notEqual(first.revision, second.revision);
      const record = await raw(orgA, "slack");
      await a.query("UPDATE org_integration_connections SET revision=$2,updated_at=updated_at WHERE org_id=$1 AND provider='slack'", [orgA, second.revision]);
      const third = await admitted(orgA, "slack"); assert.notEqual(third.revision, second.revision); assert.equal(third.updatedAt.getTime(), second.updatedAt.getTime());
      const after = await raw(orgA, "slack"); assert.equal(after.encrypted_access_token, record.encrypted_access_token);
      assert.equal(await storeA.saveRefreshedTokens(orgA, "slack", first.revision, "stale-legacy-refresh"), false);
      assert.equal(await storeA.getAccessToken(orgA, "slack", second.revision), undefined);
    });
    await control("caller-supplied insertion revision cannot reuse an earlier generation", async () => {
      const first = await admitted(orgA, "slack");
      await a.query("INSERT INTO org_integration_connections(org_id,provider,encrypted_access_token,revision) VALUES($1,'notion',$2,$3) ON CONFLICT(org_id,provider) DO UPDATE SET revision=$3", [orgB, (await raw(orgA, "slack")).encrypted_access_token, first.revision]);
      const other = await admitted(orgB, "notion"); assert.notEqual(other.revision, first.revision);
    });
    await control("tenant/provider mismatches and absent rows deny both reads and refresh without mutation", async () => {
      const captured = await admitted(orgA, "slack"), other = await raw(orgB, "slack"), current = await raw(orgA, "slack"), teams = await raw(orgA, "teams");
      assert.equal(await storeB.saveRefreshedTokens(orgB, "slack", captured.revision, "cross-tenant"), false);
      assert.equal(await storeA.getAccessToken(orgB, "slack", captured.revision), undefined);
      assert.equal(await storeA.getRefreshToken(orgB, "slack", captured.revision), undefined);
      assert.equal(await storeB.saveRefreshedTokens(orgA, "teams", captured.revision, "cross-provider"), false);
      assert.equal(await storeA.getAccessToken(orgA, "teams", captured.revision), undefined);
      assert.equal(await storeB.saveRefreshedTokens(randomUUID(), "slack", captured.revision, "missing-row"), false);
      assert.deepEqual(await raw(orgB, "slack"), other); assert.deepEqual(await raw(orgA, "slack"), current);
      assert.deepEqual(await raw(orgA, "teams"), teams);
    });
    await control("invalid and oversized refresh inputs reject before any query; stale errors carry no credentials", async () => {
      let queries = 0;
      const counted = new Proxy(a, { get(target, key) { if (key === "query") return (...args: unknown[]) => {
        queries++; return Reflect.apply(target.query, target, args);
      }; return Reflect.get(target, key); } });
      const owner = new IntegrationConnectionStore(counted, KEY), revision = (await admitted(orgA, "slack")).revision;
      const base: unknown[] = [orgA, "slack", revision, "valid-access"];
      const invalid: unknown[][] = [
        ["bad-org", "slack", revision, "valid-access"], [orgA, "unknown-provider", revision, "valid-access"],
        [orgA, "slack", "bad-revision", "valid-access"], [orgA, "slack", undefined, "valid-access"],
        [orgA, "slack", revision, ""], [orgA, "slack", revision, "   "], [orgA, "slack", revision, "has\nnewline"],
        [orgA, "slack", revision, 5], [orgA, "slack", revision, "x".repeat(65_537)], [orgA, "slack", revision, "é".repeat(32_769)],
        [...base, { refreshToken: " " }], [...base, { refreshToken: "x".repeat(65_537) }], [...base, { refreshToken: null }],
        [...base, { expiresAt: new Date(Number.NaN) }], [...base, { expiresAt: "invalid-date" }], [...base, null], [...base, []], [...base, new Date()], [...base, new Map()]
      ];
      for (const args of invalid) await assert.rejects(() => Reflect.apply(owner.saveRefreshedTokens, owner, args), /^Error: Invalid/);
      for (const expected of [null, "", "not-a-uuid", 42]) {
        await assert.rejects(() => Reflect.apply(owner.getAccessToken, owner, [orgA, "slack", expected]), /Invalid.*revision/);
        await assert.rejects(() => Reflect.apply(owner.getRefreshToken, owner, [orgA, "slack", expected]), /Invalid.*revision/);
      }
      const noKey = new IntegrationConnectionStore(counted);
      await assert.rejects(() => noKey.saveRefreshedTokens(orgA, "slack", revision, "valid-access"), /not configured/);
      assert.equal(queries, 0);
      assert.equal(await owner.getAccessToken(orgA, "slack", revision), "legacy-overwrite"); assert.equal(queries, 1);
    });
    await control("migration replay preserves its exact ledger identity and row generations", async () => {
      const before = await raw(orgA, "slack");
      const ledgerBefore = (await a.query("SELECT filename,checksum,applied_at FROM schema_migrations ORDER BY filename")).rows;
      await runMigrations({ databaseUrl: DATABASE, migrationsDir: resolve("migrations"), log: () => undefined });
      assert.deepEqual(await raw(orgA, "slack"), before);
      const ledgerAfter = (await a.query("SELECT filename,checksum,applied_at FROM schema_migrations ORDER BY filename")).rows;
      assert.deepEqual(ledgerAfter, ledgerBefore);
      assert.deepEqual(ledgerAfter.map(row => row.filename), readdirSync(resolve("migrations")).filter(name => /\.sql$/.test(name)).sort());
    });
    console.log(JSON.stringify({ suite: "EH02-actual-PG-store-lifecycle", groupedControls: controls.length, controls,
      identity: { db: identity.db, user: identity.usr, version: identity.version }, providerCalls: 0,
      actualAdminHttpDisconnect: "ROOT_CALLER_QUALIFICATION_REQUIRED", externalDoubleExchangeOrRotation: "OPEN" }));
  } finally {
    for (const orgId of orgs) await a.query("DELETE FROM organizations WHERE id=$1", [orgId]);
    await Promise.all([a.end(), b.end(), locks.end()]); rmSync(baseline, { recursive: true, force: true });
  }
});
