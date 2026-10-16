import assert from "node:assert/strict";
import test from "node:test";
import { authorizeState, callbackStateCookie, ADMIN_OAUTH_STATE_COOKIE } from "./googleOauthState";

test("admin OAuth state accepts Google only and rejects duplicate cookies", () => {
  assert.equal(authorizeState("https://accounts.google.com/o/oauth2/v2/auth?state=signed-state"), "signed-state");
  assert.equal(authorizeState("https://evil.example/o/oauth2/v2/auth?state=signed-state"), undefined);
  assert.equal(authorizeState("https://accounts.google.com/o/oauth2/v2/auth"), undefined);
  assert.equal(callbackStateCookie(new Request("https://admin.coop-ai.dev", {
    headers: { cookie: `${ADMIN_OAUTH_STATE_COOKIE}=signed-state` }
  })), "signed-state");
  assert.equal(callbackStateCookie(new Request("https://admin.coop-ai.dev", {
    headers: { cookie: `${ADMIN_OAUTH_STATE_COOKIE}=one; ${ADMIN_OAUTH_STATE_COOKIE}=two` }
  })), undefined);
});
