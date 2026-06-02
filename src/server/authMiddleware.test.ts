import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import {
  isPlanAllowed,
  requireOrgPlan,
  resolveOrgPlanFromDb,
  writePlanForbidden
} from "./authMiddleware";
import type { AuthContext, OrgPlan, OrgStore } from "./orgStore";

function mockResponse(): ServerResponse & { statusCode?: number; body?: string } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    writeHead(code: number) {
      this.statusCode = code;
    },
    end(payload: string) {
      this.body = payload;
    }
  };
  return res as ServerResponse & { statusCode?: number; body?: string };
}

function mockOrgStore(plans: Record<string, OrgPlan>): OrgStore {
  return {
    getOrganization: async (orgId: string) => {
      const plan = plans[orgId];
      if (!plan) {
        return undefined;
      }
      return {
        id: orgId,
        name: "Test Org",
        plan,
        createdAt: new Date()
      };
    }
  } as OrgStore;
}

const freeAuth: AuthContext = {
  orgId: "org-free",
  orgName: "Free",
  plan: "free",
  apiKeyId: "key-1"
};

const proAuth: AuthContext = {
  orgId: "org-pro",
  orgName: "Pro",
  plan: "pro",
  apiKeyId: "key-2"
};

void (async () => {
  const store = mockOrgStore({
    "org-free": "free",
    "org-pro": "pro"
  });

  assert.equal(await resolveOrgPlanFromDb(store, freeAuth), "free");
  assert.equal(await resolveOrgPlanFromDb(store, proAuth), "pro");
  assert.equal(isPlanAllowed("pro", ["pro", "enterprise"]), true);
  assert.equal(isPlanAllowed("free", ["pro", "enterprise"]), false);

  const denied = mockResponse();
  const allowed = await requireOrgPlan(store, freeAuth, denied, "pro", "enterprise");
  assert.equal(allowed, false);
  assert.equal(denied.statusCode, 403);
  assert.match(denied.body ?? "", /plan_required/);

  const okRes = mockResponse();
  const ok = await requireOrgPlan(store, proAuth, okRes, "pro", "enterprise");
  assert.equal(ok, true);
  assert.equal(okRes.statusCode, undefined);

  const enterpriseOnly = mockResponse();
  const enterpriseDenied = await requireOrgPlan(store, proAuth, enterpriseOnly, "enterprise");
  assert.equal(enterpriseDenied, false);
  assert.equal(enterpriseOnly.statusCode, 403);

  const forbidden = mockResponse();
  writePlanForbidden(forbidden, ["enterprise"]);
  assert.equal(forbidden.statusCode, 403);
  assert.match(forbidden.body ?? "", /enterprise/);

  console.log("authMiddleware.test.ts: ok");
})();
