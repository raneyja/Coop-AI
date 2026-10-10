import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { SupportStore } from "./supportStore";
import type { SupportSubmission } from "../../support/supportTypes";

async function main() {
  const url = process.env.SUPPORT_TEST_DATABASE_URL;
  if (!url) { console.log("support database tests skipped: set SUPPORT_TEST_DATABASE_URL to a local test database"); return; }
  const schema = `support_test_${randomUUID().replace(/-/g, "")}`;
  const admin = new Pool({ connectionString: url });
  let pool: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 6 });
    // Isolated schema: no customer tables or reports are mutated.
    await pool.query("CREATE TABLE organizations(id uuid PRIMARY KEY,name text); CREATE TABLE operators(id uuid PRIMARY KEY,email text,role text,disabled_at timestamptz); CREATE TABLE operator_audit_log(operator_id uuid,action text,target_org_id uuid,metadata jsonb)");
    await pool.query(await readFile("migrations/032_support_reports.sql", "utf8"));
    const org = randomUUID(); const operator = randomUUID();
    await pool.query("INSERT INTO organizations VALUES ($1,'Test')", [org]);
    await pool.query("INSERT INTO operators VALUES ($1,'ops@example.com','support',NULL)", [operator]);
    const store = new SupportStore(pool);
    const input: SupportSubmission = { submissionId: randomUUID(), kind: "bug", title: "Test report", description: "Steps to reproduce", contactEmail: "dev@example.com", diagnostics: { extensionVersion: "1", vscodeVersion: "2", platform: "darwin", architecture: "arm64" } };
    const receipts = await Promise.all(Array.from({ length: 6 }, () => store.submit(org, "user", input)));
    assert.equal(new Set(receipts.map((receipt) => receipt.id)).size, 1);
    const id = receipts[0].id;
    for (let i = 0; i < 9; i++) assert.equal((await store.submit(org, "user", { ...input, submissionId: randomUUID() })).limited, undefined);
    assert.equal((await store.submit(org, "user", { ...input, submissionId: randomUUID() })).limited, true);
    assert.equal((await store.submit(org, "user", input)).id, id); // Recover receipt even after the limit.
    const page = await store.list("open", 0); assert.equal(page.reports.length, 10);
    let detail = await store.detail(id); assert.equal(detail.diagnostics.extensionVersion, "1");
    const revision = detail.revision;
    assert.equal(await store.update(id, operator, { status: "resolved", assigneeId: operator, note: "Resolved after reproduction", revision }), "ok");
    assert.equal(await store.update(id, operator, { status: "open", assigneeId: null, note: "stale", revision }), "conflict");
    detail = await store.detail(id); assert.equal(detail.events.length, 1); assert.equal(detail.status, "resolved"); assert.ok(detail.resolvedAt);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM operator_audit_log")).rows[0].count, 1);
    assert.equal(await store.update(id, operator, { status: "open", assigneeId: null, note: "Reopened", revision: detail.revision }), "ok");
    detail = await store.detail(id); assert.equal(detail.resolvedAt, null); assert.equal(detail.events.length, 2);
    const contenders = await Promise.all([
      store.update(id, operator, { status: "in_progress", assigneeId: operator, note: "First operator", revision: detail.revision }),
      store.update(id, operator, { status: "resolved", assigneeId: operator, note: "Second operator", revision: detail.revision })
    ]);
    assert.deepEqual(contenders.sort(), ["conflict", "ok"]);
    detail = await store.detail(id);
    await assert.rejects(() => store.update(id, randomUUID(), { status: "resolved", assigneeId: null, note: "Must roll back", revision: detail.revision }));
    const afterRollback = await store.detail(id);
    assert.equal(afterRollback.revision, detail.revision); assert.equal(afterRollback.events.length, detail.events.length);
    assert.equal(await store.update(id, operator, { status: "open", assigneeId: randomUUID(), note: "", revision: detail.revision }), "invalid_assignee");
    await pool.query("UPDATE support_reports SET diagnostics_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [id]);
    assert.equal((await store.detail(id)).diagnostics, null); await store.purgeDiagnostics();
    assert.equal((await pool.query("SELECT diagnostics FROM support_reports WHERE id=$1", [id])).rows[0].diagnostics, null);
    const claims = await Promise.all(Array.from({ length: 6 }, () => store.claimNotification()));
    assert.equal(new Set(claims.map((claim) => claim!.id)).size, 6);
    const claim = claims[0]!; await store.finishNotification(claim.id, claim.attempts, "sent");
    assert.equal(claim.title, input.title); assert.equal(claim.description, input.description); assert.equal(claim.contactEmail, input.contactEmail);
    assert.equal(await store.retryNotification(claim.id), false);
    await pool.query("UPDATE support_reports SET notification_status='failed' WHERE id=$1", [id]);
    assert.equal(await store.retryNotification(id), true);
    console.log("support database: migration, concurrent deduplication, limits, triage, audit, expiration and notification leases passed");
  } finally {
    await pool?.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
