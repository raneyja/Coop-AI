import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleOrgApiRequest, type OrgApiDeps } from "./orgApi";
import type { AuthContext, OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";
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

function mockOrgStore(orgId: string, plan: "pro" | "enterprise"): OrgStore {
  return {
    resolveAuth: async () => undefined,
    getOrganization: async (id: string) => ({
      id,
      name: "Test Org",
      plan,
      createdAt: new Date()
    }),
    listOrgRepos: async () => [],
    getOrgRepo: async () => undefined,
    upsertOrgRepo: async (oid, repoId, patch) => ({
      orgId: oid,
      repoId,
      lightningEnabled: patch.lightningEnabled ?? false,
      indexStatus: patch.indexStatus ?? "idle",
      updatedAt: new Date()
    })
  } as unknown as OrgStore;
}

function mockUserStore(role: "member" | "admin", plan: "pro" | "enterprise"): UserStore {
  const session: ResolvedUserSession = {
    userId: "u1",
    orgId: "org-test",
    orgName: "Test Org",
    plan,
    role
  };
  return {
    resolveUserSession: async (token: string) => (token === "sess-member" ? session : undefined)
  } as unknown as UserStore;
}

function baseDeps(orgStore: OrgStore, userStore: UserStore): OrgApiDeps {
  const serverConfig: ServerConfig = {
    nodeEnv: "test",
    requireApiAuth: true,
    jobsWorkersEnabled: false,
    devMode: true
  };
  return {
    orgStore,
    userStore,
    jobQueue: {
      createJob: async () => ({ jobId: "job-1", estimatedWaitTime: 0 })
    } as unknown as OrgApiDeps["jobQueue"],
    serverConfig
  };
}

async function request(
  deps: OrgApiDeps,
  method: string,
  pathname: string,
  body: unknown = null
): Promise<{ statusCode?: number; body?: string }> {
  const response = mockResponse();
  const handled = await handleOrgApiRequest(
    {
      method,
      pathname,
      headers: { authorization: "Bearer sess-member" },
      body
    },
    response,
    deps
  );
  assert.equal(handled, true);
  return response;
}

void (async () => {
  const orgStore = mockOrgStore("org-test", "enterprise");
  const memberDeps = baseDeps(orgStore, mockUserStore("member", "enterprise"));

  const gatedEndpoints: Array<{ method: string; pathname: string; body?: unknown }> = [
    { method: "POST", pathname: "/v1/orgs/credentials/github", body: { token: "ghp_test" } },
    { method: "POST", pathname: "/v1/orgs/repos/github%3Aacme%2Fr1/lightning/enable" },
    { method: "POST", pathname: "/v1/orgs/repos/github%3Aacme%2Fr1/lightning/disable" },
    { method: "POST", pathname: "/v1/collections", body: { name: "Team repos" } },
    { method: "POST", pathname: "/v1/collections/col-1/repos", body: { repoId: "github:acme/r1" } },
    { method: "DELETE", pathname: "/v1/collections/col-1/repos/github%3Aacme%2Fr1" }
  ];

  for (const endpoint of gatedEndpoints) {
    const result = await request(memberDeps, endpoint.method, endpoint.pathname, endpoint.body ?? null);
    assert.equal(result.statusCode, 403, `${endpoint.method} ${endpoint.pathname} should be admin-gated`);
    assert.match(result.body ?? "", /admin_required/, `${endpoint.method} ${endpoint.pathname} should return admin_required`);
  }

  const adminAuth: AuthContext = {
    orgId: "org-test",
    orgName: "Test Org",
    plan: "enterprise",
    apiKeyId: "key-admin"
  };
  const adminOrgStore = {
    ...mockOrgStore("org-test", "enterprise"),
    resolveAuth: async () => adminAuth
  } as OrgStore;
  const adminDeps = baseDeps(adminOrgStore, mockUserStore("admin", "enterprise"));

  const adminEnable = await request(
    adminDeps,
    "POST",
    "/v1/orgs/repos/github%3Aacme%2Fr2/lightning/enable"
  );
  assert.notEqual(adminEnable.statusCode, 403);
  assert.doesNotMatch(adminEnable.body ?? "", /admin_required/);

  console.log("orgApiAdminGate.test.ts: ok");
})();
