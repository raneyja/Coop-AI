import test from "node:test";
import assert from "node:assert/strict";
import { createSlackAppService } from "./slackAppService";

test("buildAuthorizeUrl includes client, scopes, and signed state", () => {
  const service = createSlackAppService("client-id", "client-secret", "state-secret");
  const url = new URL(service.buildAuthorizeUrl("https://api.example/oauth/slack/callback", "org-42"));
  assert.equal(url.origin + url.pathname, "https://slack.com/oauth/v2/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://api.example/oauth/slack/callback");
  assert.ok(url.searchParams.get("scope")?.includes("channels:read"));
  assert.ok(url.searchParams.get("user_scope")?.includes("search:read"));
  const state = url.searchParams.get("state");
  assert.ok(state);
  assert.equal(service.verifyAndParseState(state!), "org-42");
});

test("verifyAndParseState rejects tampered state", () => {
  const service = createSlackAppService("client-id", "client-secret", "state-secret");
  const url = new URL(service.buildAuthorizeUrl("https://api.example/callback", "org-42"));
  const state = url.searchParams.get("state")!;
  assert.equal(service.verifyAndParseState(`${state}x`), undefined);
});
