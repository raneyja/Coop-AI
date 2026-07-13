#!/usr/bin/env node
/** Smoke test for operator API gates — run against local API + Postgres. */
import { getDbPool, closeDbPool } from "../src/server/db";
import { OperatorStore } from "../src/server/operators/operatorStore";
import { OrgStore } from "../src/server/orgStore";

const API_BASE = process.env.COOP_API_BASE?.trim() || "http://localhost:8787";

async function main(): Promise<void> {
  const pool = await getDbPool();
  if (!pool) {
    throw new Error("DATABASE_URL required");
  }
  const opStore = new OperatorStore(pool);
  const orgStore = new OrgStore(pool);

  const op = await opStore.findOperatorByEmail("ops-test@coop-ai.dev");
  if (!op) {
    throw new Error("Seed operator ops-test@coop-ai.dev first");
  }
  const { token } = await opStore.createSession(op.id);
  const org = await orgStore.createOrganization(`Gate Test Org ${Date.now()}`, "enterprise");
  await orgStore.updateOrgOperatorMetadata(org.id, {
    provenance: "manual_enterprise"
  });
  await orgStore.updateOrganizationBilling(org.id, {
    seatCount: 5,
    billingStatus: "manual",
    billingEmail: "admin@gatetest.example"
  });

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  async function get(path: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${API_BASE}${path}`, { headers });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  // Gate 0.3: org-admin token rejected
  const orgAdminTry = await fetch(`${API_BASE}/v1/operator/me`, {
    headers: { Authorization: "Bearer fake-org-session" }
  });
  checks.push({ name: "0.3 org token rejected", ok: orgAdminTry.status === 401 });

  // Gate 0.1 / operator me
  const me = await get("/v1/operator/me");
  checks.push({ name: "0.1 operator /me", ok: me.status === 200 && (me.body as { email?: string }).email === op.email });

  // List orgs
  const list = await get("/v1/operator/organizations?search=Gate");
  checks.push({
    name: "1.3 search orgs",
    ok: list.status === 200 && Array.isArray((list.body as { organizations?: unknown[] }).organizations)
  });

  // Attention queue
  const queue = await get("/v1/operator/attention-queue");
  checks.push({ name: "1.4 attention queue", ok: queue.status === 200 });

  // Detail
  const detail = await get(`/v1/operator/organizations/${org.id}`);
  checks.push({ name: "org detail", ok: detail.status === 200 });

  // Suspend
  const suspend = await post(`/v1/operator/organizations/${org.id}/suspend`, {
    reason: "gate test",
    confirmName: org.name
  });
  checks.push({ name: "1.5 suspend", ok: suspend.status === 200 });

  // Gate 0.4: suspended org blocked — create API key first for test
  const keyResult = await orgStore.createApiKey(org.id, "gate-test");
  const authTry = await fetch(`${API_BASE}/v1/me`, {
    headers: { Authorization: `Bearer ${keyResult.rawKey}` }
  });
  checks.push({ name: "0.4 org_suspended on API key", ok: authTry.status === 403 });

  // Activity feed
  const activity = await get("/v1/operator/activity");
  checks.push({ name: "operator activity", ok: activity.status === 200 });

  await closeDbPool();

  console.log(JSON.stringify({ orgId: org.id, orgName: org.name, checks }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.error("FAILED:", failed);
    process.exit(1);
  }
  console.log("operator-gate-smoke: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
