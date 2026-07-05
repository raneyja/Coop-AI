import test from "node:test";
import assert from "node:assert/strict";
import { testAdminIntegration } from "./adminIntegrationTest";
import { githubOAuthSyntheticInstallationId } from "./codeHostConnectors/githubOAuthConnector";
import type { ServerConfig } from "./serverConfig";

const originalFetch = globalThis.fetch;
const ORG_ID = "org-github-test";
const APP_INSTALLATION_ID = 42_001;
const OAUTH_INSTALLATION_ID = githubOAuthSyntheticInstallationId(ORG_ID);

const testServerConfig: ServerConfig = {
  nodeEnv: "test",
  requireApiAuth: true,
  jobsWorkersEnabled: false,
  devMode: false
};

function stubOrgStore(installationId: number) {
  return {
    getCodeHostInstallation: async (_orgId: string, provider: string) =>
      provider === "github"
        ? {
            installationId,
            tokenExpiresAt: new Date(Date.now() + 3_600_000),
            createdAt: new Date()
          }
        : undefined,
    getInstallationToken: async () => "ghs_test_token",
    getCredential: async () => undefined
  };
}

test("testAdminIntegration uses installation repositories for GitHub App installs", async () => {
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({ total_count: 0, repositories: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await testAdminIntegration(ORG_ID, "github", {
      orgStore: stubOrgStore(APP_INSTALLATION_ID) as never,
      serverConfig: testServerConfig
    });
    assert.equal(result.ok, true);
    assert.ok(requestedUrls.some((url) => url.includes("/installation/repositories")));
    assert.ok(!requestedUrls.some((url) => url.endsWith("/user")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testAdminIntegration uses GET /user for GitHub OAuth installs", async () => {
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify({ login: "octocat" }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await testAdminIntegration(ORG_ID, "github", {
      orgStore: stubOrgStore(OAUTH_INSTALLATION_ID) as never,
      serverConfig: testServerConfig
    });
    assert.equal(result.ok, true);
    assert.ok(requestedUrls.some((url) => url.endsWith("/user")));
    assert.ok(!requestedUrls.some((url) => url.includes("/installation/repositories")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
