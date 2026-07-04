import assert from "node:assert/strict";
import test from "node:test";
import { githubConnectCapabilities, resolveGithubInstallUrl } from "./githubInstallUrl";

const appDeps = {
  githubApp: { buildInstallUrl: (_slug: string, orgId: string) => `https://github.com/apps/coop/install?state=${orgId}` },
  githubAppConfig: { slug: "coop", appId: "1", privateKeyPem: "x", publicBaseUrl: "https://api.example.com" },
  githubOAuth: { buildAuthorizeUrl: (_redirect: string, orgId: string) => `https://github.com/login/oauth?state=${orgId}` },
  githubOAuthConfig: { clientId: "c", clientSecret: "s", publicBaseUrl: "https://api.example.com" }
};

test("resolveGithubInstallUrl prefers GitHub App in auto mode", () => {
  const result = resolveGithubInstallUrl(appDeps, "org-1", "auto");
  assert.ok(result);
  assert.equal(result.kind, "github_app");
  assert.match(result.url, /apps\/coop/);
  assert.equal(result.oauthAvailable, true);
});

test("resolveGithubInstallUrl forces OAuth when mode=oauth", () => {
  const result = resolveGithubInstallUrl(appDeps, "org-1", "oauth");
  assert.ok(result);
  assert.equal(result.kind, "oauth");
  assert.match(result.url, /login\/oauth/);
});

test("resolveGithubInstallUrl returns undefined for mode=app without app config", () => {
  const result = resolveGithubInstallUrl(
    { githubOAuth: appDeps.githubOAuth, githubOAuthConfig: appDeps.githubOAuthConfig },
    "org-1",
    "app"
  );
  assert.equal(result, undefined);
});

test("githubConnectCapabilities reflects configured connectors", () => {
  assert.deepEqual(githubConnectCapabilities(appDeps), {
    githubAppAvailable: true,
    oauthAvailable: true
  });
});
