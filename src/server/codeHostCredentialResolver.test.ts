import test from "node:test";
import assert from "node:assert/strict";
import { assessGithubConnection } from "./codeHostCredentialResolver";
import {
  githubOAuthSyntheticInstallationId,
  isGithubOAuthInstallation
} from "./codeHostConnectors/githubOAuthConnector";
import type { OrgStore } from "./orgStore";

const ORG_ID = "org-test-1";
const OAUTH_INSTALLATION_ID = githubOAuthSyntheticInstallationId(ORG_ID);
const APP_INSTALLATION_ID = 42_001;

function mockOrgStore(options: {
  installationId: number;
  tokenExpiresAt: Date;
  hasRefreshToken?: boolean;
}): OrgStore {
  return {
    getCodeHostInstallation: async () => ({
      installationId: options.installationId,
      tokenExpiresAt: options.tokenExpiresAt,
      createdAt: new Date()
    }),
    getCredential: async (_orgId: string, key: string) =>
      key === "github:refresh" && options.hasRefreshToken ? "refresh-token" : undefined
  } as unknown as OrgStore;
}

test("isGithubOAuthInstallation detects synthetic OAuth installation IDs", () => {
  assert.equal(isGithubOAuthInstallation(ORG_ID, OAUTH_INSTALLATION_ID), true);
  assert.equal(isGithubOAuthInstallation(ORG_ID, APP_INSTALLATION_ID), false);
});

test("assessGithubConnection marks OAuth as needsReconnect when token expired and no refresh token", async () => {
  const orgStore = mockOrgStore({
    installationId: OAUTH_INSTALLATION_ID,
    tokenExpiresAt: new Date(Date.now() - 60_000),
    hasRefreshToken: false
  });

  const status = await assessGithubConnection(orgStore, ORG_ID);
  assert.equal(status.installed, true);
  assert.equal(status.tokenValid, false);
  assert.equal(status.needsReconnect, true);
  assert.equal(status.hasRefreshToken, false);
});

test("assessGithubConnection treats OAuth as valid when refresh token exists", async () => {
  const orgStore = mockOrgStore({
    installationId: OAUTH_INSTALLATION_ID,
    tokenExpiresAt: new Date(Date.now() - 60_000),
    hasRefreshToken: true
  });

  const status = await assessGithubConnection(orgStore, ORG_ID);
  assert.equal(status.tokenValid, true);
  assert.equal(status.needsReconnect, false);
});

test("assessGithubConnection treats GitHub App install as always valid", async () => {
  const orgStore = mockOrgStore({
    installationId: APP_INSTALLATION_ID,
    tokenExpiresAt: new Date(Date.now() - 60_000),
    hasRefreshToken: false
  });

  const status = await assessGithubConnection(orgStore, ORG_ID);
  assert.equal(status.installed, true);
  assert.equal(status.tokenValid, true);
  assert.equal(status.needsReconnect, false);
});

test("assessGithubConnection returns disconnected when no installation", async () => {
  const orgStore = {
    getCodeHostInstallation: async () => undefined,
    getCredential: async () => undefined
  } as unknown as OrgStore;

  const status = await assessGithubConnection(orgStore, ORG_ID);
  assert.deepEqual(status, {
    installed: false,
    tokenValid: false,
    needsReconnect: false,
    hasRefreshToken: false
  });
});
