import test from "node:test";
import assert from "node:assert/strict";
import {
  createSlackAppService,
  isSlackBotAccessToken,
  isSlackUserAccessToken
} from "./slackAppService";

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

test("token type helpers distinguish user vs bot prefixes", () => {
  assert.equal(isSlackUserAccessToken("xoxp-abc"), true);
  assert.equal(isSlackUserAccessToken("xoxe.xoxp-1-abc"), true);
  assert.equal(isSlackBotAccessToken("xoxb-abc"), true);
  assert.equal(isSlackBotAccessToken("xoxe.xoxb-1-abc"), true);
  assert.equal(isSlackUserAccessToken("xoxb-abc"), false);
  assert.equal(isSlackBotAccessToken("xoxp-abc"), false);
});

test("exchangeCode requires authed_user token and stores user refresh not bot", async () => {
  const originalFetch = globalThis.fetch;
  const service = createSlackAppService("client-id", "client-secret", "state-secret");
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        access_token: "xoxb-bot-token",
        refresh_token: "xoxe-bot-refresh",
        expires_in: 43200,
        team: { id: "T1", name: "Acme" },
        authed_user: {
          id: "U1",
          access_token: "xoxp-user-token",
          refresh_token: "xoxe-user-refresh",
          expires_in: 3600
        }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  try {
    const result = await service.exchangeCode("code", "https://api.example/callback");
    assert.equal(result.userAccessToken, "xoxp-user-token");
    assert.equal(result.botAccessToken, "xoxb-bot-token");
    assert.equal(result.refreshToken, "xoxe-user-refresh");
    assert.ok(result.expiresAt);
    const msUntilExpiry = result.expiresAt!.getTime() - Date.now();
    assert.ok(msUntilExpiry > 3500 * 1000 && msUntilExpiry < 3600 * 1000 + 5000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeCode fails when Slack omits user token (no bot fallback)", async () => {
  const originalFetch = globalThis.fetch;
  const service = createSlackAppService("client-id", "client-secret", "state-secret");
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        access_token: "xoxb-bot-only",
        team: { id: "T1", name: "Acme" },
        authed_user: { id: "U1" }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  try {
    await assert.rejects(
      () => service.exchangeCode("code", "https://api.example/callback"),
      /did not return a user token/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("refreshAccessToken rejects bot tokens", async () => {
  const originalFetch = globalThis.fetch;
  const service = createSlackAppService("client-id", "client-secret", "state-secret");
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        access_token: "xoxb-should-not-store",
        refresh_token: "xoxe-new",
        expires_in: 43200
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  try {
    await assert.rejects(
      () => service.refreshAccessToken("xoxe-old"),
      /bot token/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
