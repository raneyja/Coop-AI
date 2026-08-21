import assert from "node:assert/strict";
import test from "node:test";
import {
  GITHUB_NOT_CONNECTED_MESSAGE,
  GITHUB_OAUTH_WRITE_PERMISSION_MESSAGE,
  GITHUB_WRITE_PERMISSION_MESSAGE
} from "../api/codeHosts/pullRequestWrite";
import { inspectGithubPullWrite, type InspectGithubPullWriteOptions } from "./githubPullWriteReadiness";
import { githubOAuthSyntheticInstallationId } from "./codeHostConnectors/githubOAuthConnector";

const ORG_ID = "org-test";
const APP_INSTALLATION_ID = 144402900;
const originalFetch = globalThis.fetch;

type StoreOptions = {
  installationId?: number;
  installationToken?: string;
  credential?: string;
};

function mockStore(options: StoreOptions): {
  store: InspectGithubPullWriteOptions["orgStore"];
  upserts: Array<{ installationId: number; token: string }>;
} {
  const upserts: Array<{ installationId: number; token: string }> = [];
  return {
    upserts,
    store: {
      getCodeHostInstallation: async () =>
        options.installationId
          ? ({
              orgId: ORG_ID,
              provider: "github",
              installationId: options.installationId,
              tokenExpiresAt: new Date(Date.now() + 3_600_000),
              createdAt: new Date()
            } as never)
          : undefined,
      getInstallationToken: async () => options.installationToken,
      getCredential: async () => options.credential,
      upsertCodeHostInstallation: async (
        _orgId: string,
        _provider: string,
        installationId: number,
        token: string
      ) => {
        upserts.push({ installationId, token });
      }
    } as InspectGithubPullWriteOptions["orgStore"]
  };
}

function mockRepoFetch(options: { status?: number; scopes?: string | null }): void {
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input);
    if (/\/repos\/raneyja\/Coop-AI$/.test(url)) {
      const status = options.status ?? 200;
      if (status !== 200) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status });
      }
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (options.scopes !== null && options.scopes !== undefined) {
        headers["x-oauth-scopes"] = options.scopes;
      }
      return new Response(JSON.stringify({ default_branch: "main" }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
  }) as typeof fetch;
}

function appService(attempt: Awaited<ReturnType<NonNullable<InspectGithubPullWriteOptions["githubApp"]>["tryCreatePullWriteAccessToken"]>>) {
  return {
    tryCreatePullWriteAccessToken: async () => attempt
  } as NonNullable<InspectGithubPullWriteOptions["githubApp"]>;
}

function inspect(
  overrides: Partial<InspectGithubPullWriteOptions> & Pick<InspectGithubPullWriteOptions, "orgStore">
) {
  return inspectGithubPullWrite({
    orgId: ORG_ID,
    owner: "raneyja",
    repo: "Coop-AI",
    ...overrides
  });
}

test("App installation that never accepted write reports the Accept reason with GitHub's wording", async () => {
  const { store } = mockStore({ installationId: APP_INSTALLATION_ID });
  mockRepoFetch({ scopes: null });
  try {
    const readiness = await inspect({
      orgStore: store,
      githubApp: appService({
        ok: false,
        githubMessage: "The permissions requested are not granted to this installation."
      })
    });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.reason, "app_permissions_not_accepted");
    assert.equal(readiness.message, GITHUB_WRITE_PERMISSION_MESSAGE);
    assert.equal(readiness.tokenKind, "github_app");
    assert.equal(readiness.installationId, APP_INSTALLATION_ID);
    assert.match(readiness.githubDetail ?? "", /not granted to this installation/);
    assert.equal(readiness.token, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("App installation with write access is ready and persists the minted token", async () => {
  const { store, upserts } = mockStore({ installationId: APP_INSTALLATION_ID });
  mockRepoFetch({ scopes: null });
  try {
    const readiness = await inspect({
      orgStore: store,
      githubApp: appService({
        ok: true,
        token: "ghs_write",
        expiresAt: new Date(Date.now() + 3_600_000),
        permissions: { contents: "write", pull_requests: "write" }
      })
    });
    assert.equal(readiness.ok, true);
    assert.equal(readiness.reason, "ready");
    assert.equal(readiness.token, "ghs_write");
    assert.deepEqual(upserts, [{ installationId: APP_INSTALLATION_ID, token: "ghs_write" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("App with write access but repo outside Repository access reports repo_not_in_installation", async () => {
  const { store } = mockStore({ installationId: APP_INSTALLATION_ID });
  mockRepoFetch({ status: 404 });
  try {
    const readiness = await inspect({
      orgStore: store,
      githubApp: appService({
        ok: true,
        token: "ghs_write",
        expiresAt: new Date(Date.now() + 3_600_000),
        permissions: { contents: "write", pull_requests: "write" }
      })
    });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.reason, "repo_not_in_installation");
    assert.match(readiness.message, /Repository access/);
    assert.match(readiness.message, /raneyja\/Coop-AI/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mint that silently downgrades to contents=read is still an Accept problem", async () => {
  const { store } = mockStore({ installationId: APP_INSTALLATION_ID });
  mockRepoFetch({ scopes: null });
  try {
    const readiness = await inspect({
      orgStore: store,
      githubApp: appService({
        ok: false,
        githubMessage: "Installation 1 granted contents=read, pull_requests=read.",
        permissions: { contents: "read", pull_requests: "read" }
      })
    });
    assert.equal(readiness.reason, "app_permissions_not_accepted");
    assert.deepEqual(readiness.grantedPermissions, { contents: "read", pull_requests: "read" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OAuth connection without repo scope reports the reconnect reason, not the App Accept reason", async () => {
  const { store } = mockStore({
    installationId: githubOAuthSyntheticInstallationId(ORG_ID),
    installationToken: "gho_limited"
  });
  mockRepoFetch({ scopes: "read:user" });
  try {
    const readiness = await inspect({ orgStore: store });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.reason, "oauth_token_cannot_write");
    assert.equal(readiness.message, GITHUB_OAUTH_WRITE_PERMISSION_MESSAGE);
    assert.equal(readiness.tokenKind, "oauth");
    assert.match(readiness.githubDetail ?? "", /read:user/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("no GitHub connection reports not_connected", async () => {
  const { store } = mockStore({});
  try {
    const readiness = await inspect({ orgStore: store });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.reason, "not_connected");
    assert.equal(readiness.message, GITHUB_NOT_CONNECTED_MESSAGE);
    assert.equal(readiness.tokenKind, "none");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("every block reason has its own sentence", () => {
  const messages = new Set([
    GITHUB_WRITE_PERMISSION_MESSAGE,
    GITHUB_OAUTH_WRITE_PERMISSION_MESSAGE,
    GITHUB_NOT_CONNECTED_MESSAGE
  ]);
  assert.equal(messages.size, 3, "block reasons must not share copy");
});
