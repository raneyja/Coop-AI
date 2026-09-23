import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import type { Pool } from "pg";
import { chatRepoListFromWorkspaceRepos } from "../chat/workspaceRepoExplorer";
import { indexingPlanCapLabel } from "../webview/components/settings/connectionCopy";
import { handleOrgApiRequest, type OrgApiDeps } from "./orgApi";
import type { AuthContext, OrgPlan, OrgRepoRecord, OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";

const READY = "github:acme/ready";
const ALSO_READY = "github:acme/also";
const BUILDING = "github:acme/building";
const BROKEN = "github:acme/broken";
const PLAIN = "github:acme/plain";
const STRANGER = "github:acme/stranger";

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

function repo(
  orgId: string,
  repoId: string,
  patch: Partial<OrgRepoRecord> & { lightningEnabled: boolean; indexStatus: OrgRepoRecord["indexStatus"] }
): OrgRepoRecord {
  return {
    orgId,
    repoId,
    updatedAt: new Date(),
    defaultBranch: repoId === READY ? "preview" : "main",
    ...patch
  };
}

function mixedRepos(orgId: string): OrgRepoRecord[] {
  return [
    repo(orgId, READY, { lightningEnabled: true, indexStatus: "ready" }),
    repo(orgId, ALSO_READY, { lightningEnabled: true, indexStatus: "ready" }),
    repo(orgId, BUILDING, { lightningEnabled: true, indexStatus: "indexing" }),
    repo(orgId, BROKEN, { lightningEnabled: true, indexStatus: "ready", browseStatus: "failed" }),
    repo(orgId, PLAIN, { lightningEnabled: false, indexStatus: "idle" })
  ];
}

function createOrgStore(input: {
  orgId: string;
  plan: OrgPlan;
  repos: OrgRepoRecord[];
  userId?: string;
  repoAccessMode?: "all_indexed" | "per_user";
  discoverGithub?: boolean;
}): OrgStore {
  const auth: AuthContext = {
    orgId: input.orgId,
    orgName: "Acme",
    plan: input.plan,
    apiKeyId: "key-test",
    ...(input.userId ? { userId: input.userId } : {})
  };
  return {
    resolveAuth: async () => auth,
    getOrganization: async () => ({
      id: input.orgId,
      name: "Acme",
      plan: input.plan,
      repoAccessMode: input.repoAccessMode ?? "all_indexed",
      createdAt: new Date()
    }),
    getOrganizationBilling: async () => ({ seatCount: 1, billingStatus: "active" }),
    listOrgRepos: async () => input.repos,
    getOrgRepo: async (_orgId: string, repoId: string) => input.repos.find((entry) => entry.repoId === repoId),
    isOrgSuspended: async () => false,
    getCodeHostInstallation: async (_orgId: string, provider: string) =>
      input.discoverGithub && provider === "github"
        ? {
            orgId: input.orgId,
            provider: "github",
            installationId: 4242,
            tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
            createdAt: new Date()
          }
        : undefined,
    getInstallationToken: async () => (input.discoverGithub ? "test-token" : undefined),
    getCredential: async () => undefined
  } as unknown as OrgStore;
}

function grantPool(grants: string[]): Pool & { workspaceQueries: number } {
  const pool = {
    workspaceQueries: 0,
    query: async (sql: string) => {
      if (sql.includes("user_workspace_repos")) {
        pool.workspaceQueries += 1;
        return { rows: [] };
      }
      if (sql.includes("user_repo_grants")) {
        return { rows: grants.map((repo_id) => ({ repo_id })) };
      }
      return { rows: [] };
    }
  };
  return pool as unknown as Pool & { workspaceQueries: number };
}

function baseDeps(orgStore: OrgStore, extra?: Partial<OrgApiDeps>): OrgApiDeps {
  const serverConfig: ServerConfig = {
    nodeEnv: "test",
    requireApiAuth: true,
    jobsWorkersEnabled: false,
    devMode: true
  };
  return {
    orgStore,
    serverConfig,
    dbPool: null,
    ...extra
  };
}

async function request(
  deps: OrgApiDeps,
  method: string,
  pathname: string
): Promise<{ statusCode?: number; body?: string }> {
  const response = mockResponse();
  const handled = await handleOrgApiRequest(
    {
      method,
      pathname,
      headers: { authorization: "Bearer test-key" },
      body: null
    },
    response,
    deps
  );
  assert.equal(handled, true);
  return response;
}

function repoIds(body: string | undefined): string[] {
  const parsed = JSON.parse(body ?? "{}") as { repos?: Array<{ repoId: string }> };
  return (parsed.repos ?? []).map((entry) => entry.repoId);
}

async function testFreeWorkspaceIgnoresStoredSelectionAndUnindexed() {
  const orgId = "org-free";
  const store = createOrgStore({ orgId, plan: "free", repos: mixedRepos(orgId) });
  const pool = grantPool([PLAIN, BUILDING]);
  const deps = baseDeps(store, { dbPool: pool });

  const workspace = await request(deps, "GET", "/v1/me/workspace-repos");
  assert.equal(workspace.statusCode, 200);
  const body = JSON.parse(workspace.body ?? "{}") as {
    repos: Array<{ repoId: string; owner: string; name: string; defaultBranch: string }>;
    selectedCount: number;
    limit: number | null;
    canAddMore: boolean;
    primaryRepoId?: string;
    adminControlled?: boolean;
  };
  assert.deepEqual(
    body.repos.map((entry) => entry.repoId),
    [READY, ALSO_READY]
  );
  assert.equal(body.selectedCount, 2);
  assert.equal(body.limit, null);
  assert.equal(body.canAddMore, false);
  assert.equal(body.primaryRepoId, READY);
  assert.equal(body.adminControlled, false);
  assert.equal(body.repos[0]?.defaultBranch, "preview");
  assert.equal(pool.workspaceQueries, 0);

  const chatList = chatRepoListFromWorkspaceRepos(body.repos);
  assert.deepEqual(
    chatList.map((entry) => `${entry.provider}:${entry.owner}/${entry.repo}`),
    [READY, ALSO_READY]
  );
  assert.equal(chatList[0]?.branch, "preview");
  assert.equal(chatList.some((entry) => entry.repo === "stranger" || entry.repo === "plain"), false);
}

async function testFreeCatalogAndCodeHostListOmitUnindexed() {
  const orgId = "org-free-catalog";
  const store = createOrgStore({
    orgId,
    plan: "free",
    repos: mixedRepos(orgId),
    discoverGithub: true
  });
  const deps = baseDeps(store, {
    githubApp: {
      listInstallationRepositoryCatalog: async () =>
        [READY, ALSO_READY, BUILDING, BROKEN, PLAIN, STRANGER].map((repoId) => ({
          repoId,
          owner: "acme",
          name: repoId.split("/")[1],
          defaultBranch: "main",
          isPrivate: false
        }))
    } as unknown as OrgApiDeps["githubApp"]
  });

  const catalog = await request(deps, "GET", "/v1/orgs/catalog/repos");
  assert.equal(catalog.statusCode, 200);
  assert.deepEqual(repoIds(catalog.body), [READY, ALSO_READY]);

  const github = await request(deps, "GET", "/v1/orgs/github/repos");
  assert.equal(github.statusCode, 200);
  assert.deepEqual(repoIds(github.body), [READY, ALSO_READY]);
}

async function testProAllIndexedAndPerUser() {
  const allId = "org-pro-all";
  const allStore = createOrgStore({ orgId: allId, plan: "pro", repos: mixedRepos(allId) });
  const all = await request(baseDeps(allStore), "GET", "/v1/me/workspace-repos");
  assert.equal(all.statusCode, 200);
  const allBody = JSON.parse(all.body ?? "{}") as {
    adminControlled?: boolean;
    repoAccessMode?: string;
    limit: number | null;
    canAddMore: boolean;
  };
  assert.deepEqual(repoIds(all.body), [READY, ALSO_READY]);
  assert.equal(allBody.adminControlled, true);
  assert.equal(allBody.repoAccessMode, "all_indexed");
  assert.equal(allBody.limit, null);
  assert.equal(allBody.canAddMore, false);

  const grantId = "org-pro-grant";
  const grantStoreOrg = createOrgStore({
    orgId: grantId,
    plan: "pro",
    repos: mixedRepos(grantId),
    userId: "user-granted",
    repoAccessMode: "per_user"
  });
  const granted = await request(
    baseDeps(grantStoreOrg, { dbPool: grantPool([READY, PLAIN, BUILDING, BROKEN]) }),
    "GET",
    "/v1/me/workspace-repos"
  );
  assert.equal(granted.statusCode, 200);
  const grantBody = JSON.parse(granted.body ?? "{}") as { repoAccessMode?: string; adminControlled?: boolean };
  assert.deepEqual(repoIds(granted.body), [READY]);
  assert.equal(grantBody.repoAccessMode, "per_user");
  assert.equal(grantBody.adminControlled, true);
}

async function testFreePlanCapStillReported() {
  const orgId = "org-free-cap";
  const store = createOrgStore({
    orgId,
    plan: "free",
    repos: [repo(orgId, READY, { lightningEnabled: true, indexStatus: "ready" })]
  });
  const me = await request(baseDeps(store), "GET", "/v1/me");
  assert.equal(me.statusCode, 200);
  const body = JSON.parse(me.body ?? "{}") as {
    indexedRepoCount?: number;
    indexedRepoLimit?: number | null;
  };
  assert.equal(body.indexedRepoCount, 1);
  assert.equal(body.indexedRepoLimit, 3);
  assert.equal(indexingPlanCapLabel(body.indexedRepoCount ?? 0, body.indexedRepoLimit ?? 0), "1 of 3 Deep-Indexed repos on your plan");
}

async function run() {
  await testFreeWorkspaceIgnoresStoredSelectionAndUnindexed();
  await testFreeCatalogAndCodeHostListOmitUnindexed();
  await testProAllIndexedAndPerUser();
  await testFreePlanCapStillReported();
  console.log("workspaceReposAccess.test.ts: ok");
}

void run();
