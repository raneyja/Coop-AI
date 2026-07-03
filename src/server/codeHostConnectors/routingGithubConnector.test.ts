import test from "node:test";
import assert from "node:assert/strict";
import { RoutingGitHubConnector } from "./routingGithubConnector";
import { githubOAuthSyntheticInstallationId } from "./githubOAuthConnector";
import type { CodeHostConnector, TokenRefreshResult } from "./types";

const ORG_ID = "org-routing-test";
const OAUTH_INSTALLATION_ID = githubOAuthSyntheticInstallationId(ORG_ID);
const APP_INSTALLATION_ID = 99_001;

function stubConnector(
  label: string,
  refreshResult: TokenRefreshResult
): CodeHostConnector & { refreshCalls: number[]; installUrls: string[] } {
  const connector = {
    provider: "github" as const,
    refreshCalls: [] as number[],
    installUrls: [] as string[],
    buildInstallUrl(orgId: string) {
      this.installUrls.push(orgId);
      return `https://example.com/${label}/install?org=${orgId}`;
    },
    async refreshInstallationToken(installationId: number) {
      this.refreshCalls.push(installationId);
      return refreshResult;
    }
  };
  return connector;
}

test("RoutingGitHubConnector prefers GitHub App install URL when both connectors exist", () => {
  const appConnector = stubConnector("app", { token: "app-token", expiresAt: new Date() });
  const oauthConnector = stubConnector("oauth", { token: "oauth-token", expiresAt: new Date() });
  const routing = new RoutingGitHubConnector({
    appConnector: appConnector as never,
    oauthConnector: oauthConnector as never
  });

  const url = routing.buildInstallUrl(ORG_ID);
  assert.equal(url, `https://example.com/app/install?org=${ORG_ID}`);
  assert.deepEqual(appConnector.installUrls, [ORG_ID]);
  assert.deepEqual(oauthConnector.installUrls, []);
});

test("RoutingGitHubConnector delegates OAuth refresh for synthetic installation IDs", async () => {
  const appConnector = stubConnector("app", { token: "app-token", expiresAt: new Date() });
  const oauthConnector = stubConnector("oauth", { token: "oauth-token", expiresAt: new Date() });
  const orgStore = {
    findOrgIdByInstallation: async (installationId: number) =>
      installationId === OAUTH_INSTALLATION_ID ? ORG_ID : undefined
  };
  const routing = new RoutingGitHubConnector({
    appConnector: appConnector as never,
    oauthConnector: oauthConnector as never,
    orgStore: orgStore as never
  });

  const result = await routing.refreshInstallationToken(OAUTH_INSTALLATION_ID);
  assert.equal(result.token, "oauth-token");
  assert.deepEqual(oauthConnector.refreshCalls, [OAUTH_INSTALLATION_ID]);
  assert.deepEqual(appConnector.refreshCalls, []);
});

test("RoutingGitHubConnector delegates GitHub App refresh for real installation IDs", async () => {
  const appConnector = stubConnector("app", { token: "app-token", expiresAt: new Date() });
  const oauthConnector = stubConnector("oauth", { token: "oauth-token", expiresAt: new Date() });
  const orgStore = {
    findOrgIdByInstallation: async (installationId: number) =>
      installationId === APP_INSTALLATION_ID ? ORG_ID : undefined
  };
  const routing = new RoutingGitHubConnector({
    appConnector: appConnector as never,
    oauthConnector: oauthConnector as never,
    orgStore: orgStore as never
  });

  const result = await routing.refreshInstallationToken(APP_INSTALLATION_ID);
  assert.equal(result.token, "app-token");
  assert.deepEqual(appConnector.refreshCalls, [APP_INSTALLATION_ID]);
  assert.deepEqual(oauthConnector.refreshCalls, []);
});
