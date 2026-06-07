import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import {
  authUserId,
  isPlanAllowed,
  requireAuth,
  requireOrgPlan,
  resolveAuthContext,
  resolveOrgPlanFromDb,
  writePlanForbidden
} from "./authMiddleware";
import type { AuthContext, OrgPlan, OrgStore } from "./orgStore";
import type { ResolvedUserSession, UserStore } from "./users/userStore";

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

function orgStoreWithApiAuth(apiAuth: AuthContext | undefined): OrgStore {
  return {
    resolveAuth: async () => apiAuth,
    getOrganization: async () => undefined
  } as unknown as OrgStore;
}

function mockUserStore(sessions: Record<string, ResolvedUserSession>): UserStore {
  return {
    resolveUserSession: async (token: string) => sessions[token]
  } as unknown as UserStore;
}

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

  // authUserId: human id for SSO, apikey principal otherwise — never bare orgId.
  assert.equal(authUserId({ orgId: "org1", orgName: "O", plan: "pro", apiKeyId: "k1" }), "apikey:k1");
  assert.equal(
    authUserId({ orgId: "org1", orgName: "O", plan: "enterprise", apiKeyId: "session:u1", userId: "u1", role: "member" }),
    "u1"
  );

  const sessionUser: ResolvedUserSession = {
    userId: "u1",
    orgId: "org1",
    orgName: "Org",
    plan: "enterprise",
    role: "admin"
  };

  // API-key path unchanged: org auth wins even when a userStore is supplied.
  const apiAuth: AuthContext = { orgId: "org1", orgName: "Org", plan: "pro", apiKeyId: "key" };
  const apiResolved = await resolveAuthContext(
    { authorization: "Bearer some-api-key" },
    orgStoreWithApiAuth(apiAuth),
    undefined,
    true,
    mockUserStore({ "sess-token": sessionUser })
  );
  assert.deepEqual(apiResolved, apiAuth);
  assert.equal(apiResolved?.userId, undefined);

  // SSO session resolves to a human user_id.
  const ssoResolved = await resolveAuthContext(
    { authorization: "Bearer sess-token" },
    orgStoreWithApiAuth(undefined),
    undefined,
    true,
    mockUserStore({ "sess-token": sessionUser })
  );
  assert.equal(ssoResolved?.userId, "u1");
  assert.equal(ssoResolved?.orgId, "org1");
  assert.equal(ssoResolved?.role, "admin");
  assert.equal(authUserId(ssoResolved!), "u1");

  // Deactivated/expired session -> resolveUserSession undefined -> 401 in production.
  const deadResolved = await resolveAuthContext(
    { authorization: "Bearer revoked-token" },
    orgStoreWithApiAuth(undefined),
    undefined,
    true,
    mockUserStore({})
  );
  assert.equal(deadResolved, undefined);
  assert.equal(requireAuth(deadResolved, true), false);

  const { canInstallIntegrations, requireInstallAdmin } = await import("./authMiddleware");
  assert.equal(canInstallIntegrations({ orgId: "o", orgName: "O", plan: "enterprise", apiKeyId: "k1" }), true);
  assert.equal(
    canInstallIntegrations({
      orgId: "o",
      orgName: "O",
      plan: "enterprise",
      apiKeyId: "session:u1",
      userId: "u1",
      role: "member"
    }),
    false
  );
  assert.equal(
    canInstallIntegrations({
      orgId: "o",
      orgName: "O",
      plan: "enterprise",
      apiKeyId: "session:u1",
      userId: "u1",
      role: "admin"
    }),
    true
  );

  console.log("authMiddleware.test.ts: ok");
})();
