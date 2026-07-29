import assert from "node:assert/strict";
import test from "node:test";
import { loadGitLabAppConfig } from "./gitlabAppConfig";

test("loadGitLabAppConfig returns undefined when env missing", () => {
  assert.equal(loadGitLabAppConfig({}), undefined);
  assert.equal(loadGitLabAppConfig({ GITLAB_APP_ID: "id" }), undefined);
  assert.equal(loadGitLabAppConfig({ GITLAB_APP_SECRET: "secret" }), undefined);
});

test("loadGitLabAppConfig returns config when ID and secret set", () => {
  const config = loadGitLabAppConfig({
    GITLAB_APP_ID: "gl-id",
    GITLAB_APP_SECRET: "gl-secret",
    WEBHOOK_DOMAIN: "https://api.example.com"
  });
  assert.ok(config);
  assert.equal(config.clientId, "gl-id");
  assert.equal(config.clientSecret, "gl-secret");
  assert.equal(config.gitlabBaseUrl, "https://gitlab.com");
  assert.equal(config.publicBaseUrl, "https://api.example.com");
});

test("loadGitLabAppConfig respects GITLAB_BASE_URL", () => {
  const config = loadGitLabAppConfig({
    GITLAB_APP_ID: "gl-id",
    GITLAB_APP_SECRET: "gl-secret",
    GITLAB_BASE_URL: "https://gitlab.example.com/",
    WEBHOOK_DOMAIN: "http://localhost:8787"
  });
  assert.ok(config);
  assert.equal(config.gitlabBaseUrl, "https://gitlab.example.com");
});
