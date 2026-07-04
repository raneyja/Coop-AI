import assert from "node:assert/strict";
import test from "node:test";
import { loadGitHubAppConfig } from "./githubAppConfig";

const RSA_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAtest
-----END RSA PRIVATE KEY-----`;

const PKCS8_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCtest
-----END PRIVATE KEY-----`;

test("loadGitHubAppConfig accepts GitHub RSA private key PEM", () => {
  const config = loadGitHubAppConfig({
    GITHUB_APP_ID: "4216192",
    GITHUB_APP_PRIVATE_KEY: RSA_PEM,
    GITHUB_APP_SLUG: "CoopAI_Production",
    COOP_PUBLIC_BASE_URL: "https://api.coop-ai.dev"
  });
  assert.ok(config);
  assert.equal(config?.appId, "4216192");
  assert.match(config?.privateKeyPem ?? "", /BEGIN RSA PRIVATE KEY/);
});

test("loadGitHubAppConfig accepts PKCS8 private key PEM", () => {
  const config = loadGitHubAppConfig({
    GITHUB_APP_ID: "1",
    GITHUB_APP_PRIVATE_KEY: PKCS8_PEM
  });
  assert.ok(config);
  assert.match(config?.privateKeyPem ?? "", /BEGIN PRIVATE KEY/);
});

test("loadGitHubAppConfig accepts base64-encoded RSA PEM", () => {
  const config = loadGitHubAppConfig({
    GITHUB_APP_ID: "1",
    GITHUB_APP_PRIVATE_KEY: Buffer.from(RSA_PEM).toString("base64")
  });
  assert.ok(config);
  assert.match(config?.privateKeyPem ?? "", /BEGIN RSA PRIVATE KEY/);
});
