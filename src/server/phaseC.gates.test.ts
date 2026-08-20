import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { CodeHostError, type CreatePullRequestResult } from "../api/codeHosts/types";
import {
  GITHUB_WRITE_PERMISSION_MESSAGE,
  PHASE_C_FIXTURE_FILES,
  PR_HANDOFF_AUDIT_ACTION,
  resetPullCreateLocks
} from "../api/codeHosts/pullRequestWrite";
import { handleOrgApiRequest, type OrgApiDeps } from "./orgApi";
import type { AuthContext, OrgStore } from "./orgStore";
import type { ServerConfig } from "./serverConfig";
import type { ResolvedUserSession, UserStore } from "./users/userStore";

const originalFetch = globalThis.fetch;

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

function mockOrgStore(orgId: string): OrgStore {
  return {
    resolveAuth: async () => undefined,
    getOrganization: async (id: string) => ({
      id,
      name: "Test Org",
      plan: "pro",
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
    }),
    getCodeHostInstallation: async () => ({
      orgId,
      provider: "github",
      installationId: 1,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date()
    }),
    getInstallationToken: async () => "ghs_test",
    isOrgSuspended: async () => false
  } as unknown as OrgStore;
}

function mockUserStore(): UserStore {
  const session: ResolvedUserSession = {
    userId: "u1",
    orgId: "org-test",
    orgName: "Test Org",
    plan: "pro",
    role: "member"
  };
  return {
    resolveUserSession: async (token: string) => (token === "sess-member" ? session : undefined)
  } as unknown as UserStore;
}

function baseDeps(
  createPullFromFiles?: OrgApiDeps["createPullFromFiles"],
  auditEvents?: Array<{ action: string; metadata?: Record<string, unknown> }>
): OrgApiDeps {
  const serverConfig: ServerConfig = {
    nodeEnv: "test",
    requireApiAuth: true,
    jobsWorkersEnabled: false,
    devMode: true
  };
  return {
    orgStore: mockOrgStore("org-test"),
    userStore: mockUserStore(),
    serverConfig,
    createPullFromFiles,
    auditLogger: {
      record: async (entry: { action: string; metadata?: Record<string, unknown> }) => {
        auditEvents?.push({ action: entry.action, metadata: entry.metadata });
      }
    } as OrgApiDeps["auditLogger"]
  };
}

async function request(
  deps: OrgApiDeps,
  method: string,
  pathname: string,
  body: unknown = null
): Promise<{ statusCode?: number; json: Record<string, unknown> }> {
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
  return {
    statusCode: response.statusCode,
    json: response.body ? (JSON.parse(response.body) as Record<string, unknown>) : {}
  };
}

const fixtureBody = {
  branch: "coop/patch",
  title: "Fixture patch",
  files: PHASE_C_FIXTURE_FILES
};

void (async () => {
  resetPullCreateLocks();

  const created: CreatePullRequestResult = {
    number: 42,
    htmlUrl: "https://github.com/acme/plane/pull/42",
    branch: "coop/patch",
    commitSha: "new-commit",
    title: "Fixture patch"
  };

  const auditEvents: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
  const ok = await request(
    baseDeps(async () => created, auditEvents),
    "POST",
    "/v1/orgs/repos/github%3Aacme%2Fplane/pulls",
    fixtureBody
  );
  assert.equal(ok.statusCode, 201, "C-G1 / C-G5 write endpoint returns 201");
  assert.equal(ok.json.htmlUrl, created.htmlUrl);
  assert.equal(ok.json.number, 42);
  assert.equal(auditEvents[0]?.action, PR_HANDOFF_AUDIT_ACTION, "C-G3 audit recorded");
  assert.equal(auditEvents[0]?.metadata?.branch, "coop/patch");

  const unauth = mockResponse();
  await handleOrgApiRequest(
    {
      method: "POST",
      pathname: "/v1/orgs/repos/github%3Aacme%2Fplane/pulls",
      headers: {},
      body: fixtureBody
    },
    unauth,
    baseDeps(async () => created)
  );
  assert.equal((unauth as { statusCode?: number }).statusCode, 401, "C-G5 write endpoint requires auth");

  const empty = await request(
    baseDeps(async () => created),
    "POST",
    "/v1/orgs/repos/github%3Aacme%2Fplane/pulls",
    { branch: "coop/patch", title: "Empty", files: [] }
  );
  assert.equal(empty.statusCode, 400, "C-P5 empty file list blocked at API");

  const gitlab = await request(
    baseDeps(async () => created),
    "POST",
    "/v1/orgs/repos/gitlab%3Aacme%2Fplane/pulls",
    fixtureBody
  );
  assert.equal(gitlab.statusCode, 201, "C-G4 GitLab Create PR uses the same write path");
  assert.equal(gitlab.json.number, created.number);

  const deniedAudit: Array<{ action: string; metadata?: Record<string, unknown> }> = [];
  const denied = await request(
    baseDeps(async () => {
      throw new CodeHostError(GITHUB_WRITE_PERMISSION_MESSAGE, "auth", 403, "github");
    }, deniedAudit),
    "POST",
    "/v1/orgs/repos/github%3Aacme%2Fplane/pulls",
    fixtureBody
  );
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json.error, GITHUB_WRITE_PERMISSION_MESSAGE);
  assert.equal(deniedAudit.length, 0, "permission failure does not audit a handoff");

  resetPullCreateLocks();
  let runs = 0;
  const deps = baseDeps(async () => {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return created;
  });
  const [first, second] = await Promise.all([
    request(deps, "POST", "/v1/orgs/repos/github%3Aacme%2Fplane/pulls", fixtureBody),
    request(deps, "POST", "/v1/orgs/repos/github%3Aacme%2Fplane/pulls", fixtureBody)
  ]);
  assert.equal(runs, 1, "C-P2 double submit creates one PR");
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.equal(first.json.number, second.json.number);

  globalThis.fetch = (async () => {
    throw new Error("GitHub HTTP must not run in route tests that inject createPullFromFiles");
  }) as typeof fetch;
  try {
    const injected = await request(
      baseDeps(async () => created),
      "POST",
      "/v1/orgs/repos/github%3Aacme%2Fplane/pulls",
      fixtureBody
    );
    assert.equal(injected.statusCode, 201);
  } finally {
    globalThis.fetch = originalFetch;
  }

  resetPullCreateLocks();
  console.log("phaseC.gates (server): ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
