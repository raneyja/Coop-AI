import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ServerResponse } from "node:http";
import { zoektShardFilePrefix } from "../indexing/zoektShardIdentity";
import { handleOrgApiRequest, type OrgApiDeps } from "./orgApi";
import type { AuthContext, OrgRepoRecord, OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";

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

function repo(orgId: string, repoId: string, lightningEnabled: boolean): OrgRepoRecord {
  return {
    orgId,
    repoId,
    lightningEnabled,
    indexStatus: lightningEnabled ? "ready" : "disabled",
    updatedAt: new Date()
  };
}

function createOrgStore(input: {
  orgId: string;
  plan: "pro" | "enterprise";
  repos: OrgRepoRecord[];
  seatCount?: number;
  suspended?: boolean;
}): OrgStore {
  const store = new Map(input.repos.map((entry) => [entry.repoId, { ...entry }]));
  const auth: AuthContext = {
    orgId: input.orgId,
    orgName: "Test Org",
    plan: input.plan,
    apiKeyId: "key-test"
  };

  return {
    resolveAuth: async () => auth,
    getOrganization: async (orgId: string) => ({
      id: orgId,
      name: "Test Org",
      plan: input.plan,
      createdAt: new Date()
    }),
    getOrganizationBilling: async () => ({
      seatCount: input.seatCount ?? 1,
      billingStatus: "active"
    }),
    listOrgRepos: async () => [...store.values()],
    getOrgRepo: async (_orgId: string, repoId: string) => store.get(repoId),
    upsertOrgRepo: async (orgId: string, repoId: string, patch: Partial<OrgRepoRecord>) => {
      const existing = store.get(repoId);
      const next: OrgRepoRecord = {
        orgId,
        repoId,
        lightningEnabled: patch.lightningEnabled ?? existing?.lightningEnabled ?? false,
        indexStatus: patch.indexStatus ?? existing?.indexStatus ?? "idle",
        lastJobId: patch.lastJobId ?? existing?.lastJobId,
        error: patch.error ?? existing?.error,
        updatedAt: new Date()
      };
      store.set(repoId, next);
      return next;
    },
    isOrgSuspended: async () => input.suspended === true
  } as unknown as OrgStore;
}

function baseDeps(orgStore: OrgStore): OrgApiDeps {
  const serverConfig: ServerConfig = {
    nodeEnv: "test",
    requireApiAuth: true,
    jobsWorkersEnabled: false,
    devMode: true
  };
  return {
    orgStore,
    jobQueue: {
      createJob: async () => ({ jobId: "job-1", estimatedWaitTime: 0 }),
      listAllJobs: async () => [],
      getJob: async () => undefined
    } as unknown as OrgApiDeps["jobQueue"],
    serverConfig
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

void (async () => {
  const proOrgId = "org-pro";
  const proStore = createOrgStore({
    orgId: proOrgId,
    plan: "pro",
    seatCount: 1,
    repos: [
      repo(proOrgId, "github:acme/r1", true),
      repo(proOrgId, "github:acme/r2", true),
      repo(proOrgId, "github:acme/r3", true)
    ]
  });
  const proDeps = baseDeps(proStore);

  const suspendedStore = createOrgStore({
    orgId: "org-suspended",
    plan: "pro",
    repos: [],
    suspended: true
  });
  const suspendedDeps = baseDeps(suspendedStore);
  const suspendedMe = await request(suspendedDeps, "GET", "/v1/me");
  assert.equal(suspendedMe.statusCode, 403);
  assert.match(suspendedMe.body ?? "", /org_suspended/);

  const me = await request(proDeps, "GET", "/v1/me");
  assert.equal(me.statusCode, 200);
  const meBody = JSON.parse(me.body ?? "{}") as {
    indexedRepoCount?: number;
    indexedRepoLimit?: number;
    canEnableMoreRepos?: boolean;
    seats?: number;
  };
  assert.equal(meBody.indexedRepoCount, 3);
  assert.equal(meBody.indexedRepoLimit, null);
  assert.equal(meBody.canEnableMoreRepos, true);
  assert.equal(meBody.seats, 1);

  const fourth = await request(
    proDeps,
    "POST",
    "/v1/orgs/repos/github%3Aacme%2Fr4/lightning/enable"
  );
  assert.equal(fourth.statusCode, 202);
  assert.match(fourth.body ?? "", /job-1/);

  const reenable = await request(
    proDeps,
    "POST",
    "/v1/orgs/repos/github%3Aacme%2Fr2/lightning/enable"
  );
  assert.equal(reenable.statusCode, 202);
  assert.match(reenable.body ?? "", /job-1/);

  const entOrgId = "org-ent";
  const entRepos = Array.from({ length: 4 }, (_entry, index) =>
    repo(entOrgId, `github:acme/r${index + 1}`, true)
  );
  const entStore = createOrgStore({
    orgId: entOrgId,
    plan: "enterprise",
    repos: entRepos
  });
  const entDeps = baseDeps(entStore);

  const fifth = await request(
    entDeps,
    "POST",
    "/v1/orgs/repos/github%3Aacme%2Fr5/lightning/enable"
  );
  assert.equal(fifth.statusCode, 202);

  const tables: Record<string, Array<{ org_id: string; repo_id: string }>> = {
    user_repo_grants: [],
    repo_symbol_index: [
      { org_id: proOrgId, repo_id: "github:acme/r1" },
      { org_id: "org-other", repo_id: "github:acme/r1" }
    ],
    repo_embeddings: [
      { org_id: proOrgId, repo_id: "github:acme/r1" },
      { org_id: "org-other", repo_id: "github:acme/r1" }
    ],
    repo_stats: [
      { org_id: proOrgId, repo_id: "github:acme/r1" },
      { org_id: "org-other", repo_id: "github:acme/r1" }
    ],
    repo_dependency_edges: [
      { org_id: proOrgId, repo_id: "github:acme/r1" },
      { org_id: "org-other", repo_id: "github:acme/r1" }
    ],
    repo_manifests: [
      { org_id: proOrgId, repo_id: "github:acme/r1" },
      { org_id: "org-other", repo_id: "github:acme/r1" }
    ],
    graph_snapshots: [
      { org_id: proOrgId, repo_id: "github:acme/r1" },
      { org_id: "org-other", repo_id: "github:acme/r1" }
    ]
  };
  const purgePool = {
    query: async (sql: string, params: unknown[] = []) => {
      const match = /^DELETE FROM (\w+)/i.exec(sql.trim());
      if (!match) {
        return { rows: [], rowCount: 0 };
      }
      const table = match[1];
      const rows = tables[table];
      if (!rows) {
        return { rows: [], rowCount: 0 };
      }
      const before = rows.length;
      tables[table] = rows.filter(
        (row) => !(row.org_id === params[0] && row.repo_id === params[1])
      );
      return { rows: [], rowCount: before - tables[table].length };
    }
  };
  const shardRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coop-zoekt-purge-"));
  const previousIndex = process.env.ZOEKT_INDEX_PATH;
  process.env.ZOEKT_INDEX_PATH = shardRoot;
  const ownShard = `${zoektShardFilePrefix(proOrgId, "github:acme/r1")}_v16.00000.zoekt`;
  const otherShard = `${zoektShardFilePrefix("org-other", "github:acme/r1")}_v16.00000.zoekt`;
  fs.writeFileSync(path.join(shardRoot, ownShard), "a");
  fs.writeFileSync(path.join(shardRoot, otherShard), "b");
  try {
    const disable = await request(
      { ...proDeps, dbPool: purgePool as never },
      "POST",
      "/v1/orgs/repos/github%3Aacme%2Fr1/lightning/disable"
    );
    assert.equal(disable.statusCode, 200);
    const body = JSON.parse(disable.body ?? "{}") as { purged?: boolean; grantsDeleted?: number };
    assert.equal(body.purged, true);
    for (const table of [
      "repo_symbol_index",
      "repo_embeddings",
      "repo_stats",
      "repo_dependency_edges",
      "repo_manifests",
      "graph_snapshots"
    ]) {
      assert.equal(
        tables[table].filter((row) => row.org_id === proOrgId).length,
        0,
        table
      );
      assert.equal(tables[table].filter((row) => row.org_id === "org-other").length, 1, table);
    }
    assert.equal(fs.existsSync(path.join(shardRoot, ownShard)), false);
    assert.equal(fs.existsSync(path.join(shardRoot, otherShard)), true);
  } finally {
    if (previousIndex === undefined) {
      delete process.env.ZOEKT_INDEX_PATH;
    } else {
      process.env.ZOEKT_INDEX_PATH = previousIndex;
    }
    fs.rmSync(shardRoot, { recursive: true, force: true });
  }

  console.log("orgApiIndexing: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
