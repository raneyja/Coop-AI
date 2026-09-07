import assert from "node:assert/strict";
import test from "node:test";
import {
  GITHUB_NOT_CONNECTED_MESSAGE,
  GITHUB_OAUTH_WRITE_PERMISSION_MESSAGE,
  GITHUB_WRITE_PERMISSION_MESSAGE,
  githubAppNotInstalledOnAccountMessage,
  githubInstallationAcceptMessage
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

type AppService = NonNullable<InspectGithubPullWriteOptions["githubApp"]>;
type Attempt = Awaited<ReturnType<AppService["tryCreatePullWriteAccessToken"]>>;
type RepoInstallation = Awaited<ReturnType<AppService["getRepositoryInstallation"]>>;

function appService(
  attempt: Attempt | ((installationId: number) => Attempt),
  identity?: { accountLogin?: string; htmlUrl?: string; permissions?: Record<string, string> },
  installations?: Array<{ id: number; accountLogin: string; accountType: string }>,
  repoInstallation?: RepoInstallation | null
): AppService {
  return {
    tryCreatePullWriteAccessToken: async (installationId: number) =>
      typeof attempt === "function" ? attempt(installationId) : attempt,
    getInstallation: async (installationId: number) => {
      const listed = (installations ?? []).find((row) => row.id === installationId);
      const accountLogin = listed?.accountLogin ?? identity?.accountLogin;
      if (!accountLogin) {
        return identity ? ({ id: installationId, ...identity } as never) : undefined;
      }
      const htmlUrl =
        identity?.htmlUrl ??
        (listed?.accountType === "Organization"
          ? `https://github.com/organizations/${accountLogin}/settings/installations/${installationId}`
          : `https://github.com/settings/installations/${installationId}`);
      return {
        id: installationId,
        accountLogin,
        htmlUrl,
        permissions: identity?.permissions
      } as never;
    },
    listAppInstallations: async () => installations ?? [],
    getRepositoryInstallation: async () => {
      if (repoInstallation === null) {
        return undefined;
      }
      if (repoInstallation) {
        return repoInstallation;
      }
      const listed =
        (installations ?? []).find((row) => row.accountLogin.toLowerCase() === "raneyja") ??
        (installations ?? [])[0];
      if (listed) {
        return {
          id: listed.id,
          accountLogin: listed.accountLogin,
          htmlUrl:
            listed.accountType === "Organization"
              ? `https://github.com/organizations/${listed.accountLogin}/settings/installations/${listed.id}`
              : `https://github.com/settings/installations/${listed.id}`,
          permissions: identity?.permissions
        };
      }
      return {
        id: APP_INSTALLATION_ID,
        accountLogin: identity?.accountLogin,
        htmlUrl: identity?.htmlUrl,
        permissions: identity?.permissions
      };
    }
  } as AppService;
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

test("App installation that never accepted write names the account and approval page", async () => {
  const { store } = mockStore({ installationId: APP_INSTALLATION_ID });
  mockRepoFetch({ scopes: null });
  try {
    const readiness = await inspect({
      orgStore: store,
      githubApp: appService(
        {
          ok: false,
          githubMessage: "The level of access for permissions requested are not granted to this installation."
        },
        {
          accountLogin: "raneyja",
          htmlUrl: `https://github.com/settings/installations/${APP_INSTALLATION_ID}`
        }
      )
    });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.reason, "app_permissions_not_accepted");
    assert.equal(readiness.tokenKind, "github_app");
    assert.equal(readiness.installationId, APP_INSTALLATION_ID);
    assert.equal(readiness.accountLogin, "raneyja");
    assert.match(readiness.message, /raneyja/, "message names the account that must approve");
    assert.match(
      readiness.message,
      new RegExp(`settings/installations/${APP_INSTALLATION_ID}`),
      "message links the exact installation page"
    );
    assert.notEqual(
      readiness.message,
      GITHUB_WRITE_PERMISSION_MESSAGE,
      "no longer the generic sentence"
    );
    assert.match(readiness.githubDetail ?? "", /not granted to this installation/);
    assert.equal(readiness.token, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("approval landed on a different installation of the same App — Coop switches to it", async () => {
  const OTHER_ID = 987654;
  const { store, upserts } = mockStore({ installationId: APP_INSTALLATION_ID });
  mockRepoFetch({ scopes: null });
  try {
    const readiness = await inspect({
      orgStore: store,
      githubApp: appService(
        (installationId) =>
          installationId === OTHER_ID
            ? {
                ok: true,
                token: "ghs_other",
                expiresAt: new Date(Date.now() + 3_600_000),
                permissions: { contents: "write", pull_requests: "write" }
              }
            : { ok: false, githubMessage: "not granted to this installation" },
        { accountLogin: "raneyja" },
        [{ id: OTHER_ID, accountLogin: "raneyja", accountType: "User" }]
      )
    });
    assert.equal(readiness.ok, true);
    assert.equal(readiness.reason, "ready");
    assert.equal(readiness.installationId, OTHER_ID);
    assert.equal(readiness.switchedFromInstallationId, APP_INSTALLATION_ID);
    assert.equal(readiness.token, "ghs_other");
    assert.equal(upserts.length, 0, "must not replace the org GitHub App with a personal install");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("company install cannot see a personal repo — use the owner's install instead", async () => {
  const CORP_ID = 144638755;
  const PERSONAL_ID = 111;
  const { store, upserts } = mockStore({ installationId: CORP_ID });
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    if (!/\/repos\/raneyja\/Coop-AI$/.test(String(input))) {
      return new Response(JSON.stringify({ message: "unexpected" }), { status: 500 });
    }
    const auth = String(
      init?.headers instanceof Headers
        ? init.headers.get("authorization")
        : (init?.headers as Record<string, string> | undefined)?.Authorization ??
          (init?.headers as Record<string, string> | undefined)?.authorization ??
          ""
    );
    const status = auth.includes("ghs_corp") ? 404 : 200;
    if (status !== 200) {
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }
    return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
  }) as typeof fetch;
  try {
    const readiness = await inspect({
      orgStore: store,
      githubApp: appService(
        (installationId) =>
          installationId === PERSONAL_ID
            ? {
                ok: true,
                token: "ghs_personal",
                expiresAt: new Date(Date.now() + 3_600_000),
                permissions: { contents: "write", pull_requests: "write" }
              }
            : {
                ok: true,
                token: "ghs_corp",
                expiresAt: new Date(Date.now() + 3_600_000),
                permissions: { contents: "write", pull_requests: "write" }
              },
        undefined,
        [
          { id: CORP_ID, accountLogin: "CoopAI-Corp", accountType: "Organization" },
          { id: PERSONAL_ID, accountLogin: "raneyja", accountType: "User" }
        ]
      )
    });
    assert.equal(readiness.ok, true);
    assert.equal(readiness.installationId, PERSONAL_ID);
    assert.equal(readiness.switchedFromInstallationId, CORP_ID);
    assert.equal(upserts.length, 0, "keep the company install for catalog; only borrow it for this PR");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a public personal repo is not treated as writable by the company GitHub App", async () => {
  const CORP_ID = 144638755;
  const PERSONAL_ID = 111;
  const { store, upserts } = mockStore({ installationId: CORP_ID });
  mockRepoFetch({ scopes: null });
  try {
    const readiness = await inspect({
      orgStore: store,
      githubApp: appService(
        (installationId) =>
          installationId === PERSONAL_ID
            ? {
                ok: true,
                token: "ghs_personal",
                expiresAt: new Date(Date.now() + 3_600_000),
                permissions: { contents: "write", pull_requests: "write" }
              }
            : {
                ok: true,
                token: "ghs_corp",
                expiresAt: new Date(Date.now() + 3_600_000),
                permissions: { contents: "write", pull_requests: "write" }
              },
        undefined,
        [
          { id: CORP_ID, accountLogin: "CoopAI-Corp", accountType: "Organization" },
          { id: PERSONAL_ID, accountLogin: "raneyja", accountType: "User" }
        ]
      )
    });
    assert.equal(readiness.ok, true);
    assert.equal(readiness.installationId, PERSONAL_ID);
    assert.equal(readiness.token, "ghs_personal");
    assert.equal(readiness.switchedFromInstallationId, CORP_ID);
    assert.equal(upserts.length, 0, "must not replace the company GitHub App with the personal install");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a public personal repo with no App install on the owner is not treated as ready", async () => {
  const CORP_ID = 144638755;
  const { store, upserts } = mockStore({ installationId: CORP_ID });
  mockRepoFetch({ scopes: null });
  try {
    const readiness = await inspect({
      orgStore: store,
      githubApp: appService(
        {
          ok: true,
          token: "ghs_corp",
          expiresAt: new Date(Date.now() + 3_600_000),
          permissions: { contents: "write", pull_requests: "write" }
        },
        { accountLogin: "CoopAI-Corp" },
        [{ id: CORP_ID, accountLogin: "CoopAI-Corp", accountType: "Organization" }],
        null
      )
    });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.reason, "repo_not_in_installation");
    assert.equal(readiness.message, githubAppNotInstalledOnAccountMessage("raneyja", "Coop-AI"));
    assert.equal(upserts.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("when the stored install is the company, a missing owner approval names raneyja not the company", async () => {
  const CORP_ID = 144638755;
  const PERSONAL_ID = 111;
  const { store } = mockStore({ installationId: CORP_ID });
  mockRepoFetch({ scopes: null });
  try {
    const readiness = await inspect({
      orgStore: store,
      githubApp: appService(
        () => ({
          ok: false,
          githubMessage: "The level of access for permissions requested are not granted to this installation."
        }),
        undefined,
        [
          { id: CORP_ID, accountLogin: "CoopAI-Corp", accountType: "Organization" },
          { id: PERSONAL_ID, accountLogin: "raneyja", accountType: "User" }
        ]
      )
    });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.installationId, PERSONAL_ID);
    assert.equal(readiness.accountLogin, "raneyja");
    assert.match(readiness.message, /raneyja/);
    assert.doesNotMatch(readiness.message, /CoopAI-Corp/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("a second installation that cannot see the repo is not used as a fix", async () => {
  const OTHER_ID = 987654;
  const { store, upserts } = mockStore({ installationId: APP_INSTALLATION_ID });
  mockRepoFetch({ status: 404 });
  try {
    const readiness = await inspect({
      orgStore: store,
      githubApp: appService(
        (installationId) =>
          installationId === OTHER_ID
            ? {
                ok: true,
                token: "ghs_other",
                expiresAt: new Date(Date.now() + 3_600_000),
                permissions: { contents: "write", pull_requests: "write" }
              }
            : { ok: false, githubMessage: "not granted to this installation" },
        { accountLogin: "raneyja" },
        [{ id: OTHER_ID, accountLogin: "raneyja", accountType: "User" }],
        null
      )
    });
    assert.equal(readiness.ok, false);
    assert.equal(readiness.reason, "repo_not_in_installation");
    assert.equal(upserts.length, 0, "never repoints the org at an installation that cannot see the repo");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accept message degrades to the installation id when GitHub gives no html_url", () => {
  const message = githubInstallationAcceptMessage({ installationId: 42 });
  assert.match(message, /settings\/installations\/42/);
  assert.match(githubInstallationAcceptMessage({}), /Nothing was created\./);
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
      githubApp: appService(
        {
          ok: true,
          token: "ghs_write",
          expiresAt: new Date(Date.now() + 3_600_000),
          permissions: { contents: "write", pull_requests: "write" }
        },
        { accountLogin: "raneyja" },
        [{ id: APP_INSTALLATION_ID, accountLogin: "raneyja", accountType: "User" }],
        null
      )
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
      }),
      allowPatFallback: false
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
