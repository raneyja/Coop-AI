import test from "node:test";
import assert from "node:assert/strict";
import { resolveIntegrationScope } from "./resolveIntegrationScope";
import type { IntegrationScopePolicyStore } from "./integrationScopePolicyStore";

function mockStore(policy: unknown): IntegrationScopePolicyStore {
  return {
    get: async () =>
      policy
        ? {
            provider: "slack",
            policy: policy as Record<string, unknown>,
            updatedAt: new Date()
          }
        : undefined,
    upsert: async () => {
      throw new Error("not implemented");
    },
    delete: async () => undefined
  } as unknown as IntegrationScopePolicyStore;
}

test("resolveIntegrationScope allows free slack without policy", async () => {
  const resolved = await resolveIntegrationScope({
    orgId: "org1",
    provider: "slack",
    orgPlan: "free",
    connected: true,
    scopePolicyStore: mockStore(undefined)
  });
  assert.equal(resolved.enforced, false);
  assert.equal(resolved.allowed, true);
  assert.equal(resolved.scopeStatus, "none");
});

test("resolveIntegrationScope blocks pro slack without allowlist", async () => {
  const resolved = await resolveIntegrationScope({
    orgId: "org1",
    provider: "slack",
    orgPlan: "pro",
    connected: true,
    scopePolicyStore: mockStore({ version: 1, mode: "allowlist", channels: [] })
  });
  assert.equal(resolved.enforced, true);
  assert.equal(resolved.allowed, false);
  assert.equal(resolved.scopeStatus, "required");
});

test("resolveIntegrationScope blocks enterprise slack without allowlist", async () => {
  const resolved = await resolveIntegrationScope({
    orgId: "org1",
    provider: "slack",
    orgPlan: "enterprise",
    connected: true,
    scopePolicyStore: mockStore({ version: 1, mode: "allowlist", channels: [] })
  });
  assert.equal(resolved.enforced, true);
  assert.equal(resolved.allowed, false);
  assert.equal(resolved.scopeStatus, "required");
});

test("resolveIntegrationScope returns active pro slack channels when allowlisted", async () => {
  const resolved = await resolveIntegrationScope({
    orgId: "org1",
    provider: "slack",
    orgPlan: "pro",
    connected: true,
    scopePolicyStore: mockStore({
      version: 1,
      mode: "allowlist",
      channels: [{ id: "C1", name: "general" }]
    })
  });
  assert.equal(resolved.enforced, true);
  assert.equal(resolved.allowed, true);
  assert.equal(resolved.scopeStatus, "active");
  assert.deepEqual(resolved.slack, { channelIds: ["C1"], channelNames: ["general"] });
});

test("resolveIntegrationScope returns active enterprise slack channels when allowlisted", async () => {
  const resolved = await resolveIntegrationScope({
    orgId: "org1",
    provider: "slack",
    orgPlan: "enterprise",
    connected: true,
    scopePolicyStore: mockStore({
      version: 1,
      mode: "allowlist",
      channels: [{ id: "C1", name: "general" }]
    })
  });
  assert.equal(resolved.enforced, true);
  assert.equal(resolved.allowed, true);
  assert.equal(resolved.scopeStatus, "active");
  assert.deepEqual(resolved.slack, { channelIds: ["C1"], channelNames: ["general"] });
});
