import assert from "node:assert/strict";
import test from "node:test";
import { authorizeState, callbackStateCookie, OPS_OAUTH_STATE_COOKIE } from "./googleOauthState";

test("operator authorize state is accepted only from Google and matches the callback cookie", () => {
  assert.equal(authorizeState("https://accounts.google.com/o/oauth2/v2/auth?state=signed-state"), "signed-state");
  assert.equal(authorizeState("https://evil.example/o/oauth2/v2/auth?state=signed-state"), undefined);
  assert.equal(authorizeState("https://accounts.google.com/o/oauth2/v2/auth"), undefined);
  assert.equal(callbackStateCookie(new Request("https://ops.coop-ai.dev", {
    headers: { cookie: `${OPS_OAUTH_STATE_COOKIE}=signed-state` }
  })), "signed-state");
  assert.equal(callbackStateCookie(new Request("https://ops.coop-ai.dev")), undefined);
  assert.equal(callbackStateCookie(new Request("https://ops.coop-ai.dev", {
    headers: { cookie: `${OPS_OAUTH_STATE_COOKIE}=one; ${OPS_OAUTH_STATE_COOKIE}=two` }
  })), undefined);
});
