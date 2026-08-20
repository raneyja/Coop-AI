import assert from "node:assert/strict";
import test from "node:test";
import { loadBitbucketAppConfig } from "./bitbucketAppConfig";
import { BitbucketAppService } from "./bitbucketAppService";

test("loadBitbucketAppConfig returns undefined when env missing", () => {
  assert.equal(loadBitbucketAppConfig({}), undefined);
  assert.equal(loadBitbucketAppConfig({ BITBUCKET_APP_ID: "id" }), undefined);
  assert.equal(loadBitbucketAppConfig({ BITBUCKET_APP_SECRET: "secret" }), undefined);
});

test("loadBitbucketAppConfig returns config when ID and secret set", () => {
  const config = loadBitbucketAppConfig({
    BITBUCKET_APP_ID: "bb-id",
    BITBUCKET_APP_SECRET: "bb-secret",
    WEBHOOK_DOMAIN: "https://api.example.com"
  });
  assert.ok(config);
  assert.equal(config.clientId, "bb-id");
  assert.equal(config.clientSecret, "bb-secret");
  assert.equal(config.publicBaseUrl, "https://api.example.com");
});

test("BitbucketAppService authorize URL includes repository scopes", () => {
  const service = new BitbucketAppService({
    clientId: "bb-id",
    clientSecret: "bb-secret",
    stateSecret: "test-state-secret-at-least-32-chars!!"
  });
  const url = service.buildAuthorizeUrl("https://api.example.com/v1/bitbucket/app/callback", "org-1");
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://bitbucket.org/site/oauth2/authorize");
  assert.equal(parsed.searchParams.get("client_id"), "bb-id");
  assert.match(parsed.searchParams.get("scope") ?? "", /repository:write/);
  assert.match(parsed.searchParams.get("scope") ?? "", /pullrequest:write/);
  assert.ok(parsed.searchParams.get("state"));
});
