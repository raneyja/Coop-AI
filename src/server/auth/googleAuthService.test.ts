import test from "node:test";
import assert from "node:assert/strict";
import { GoogleAuthService, GOOGLE_AUTH_STATE_TTL_MS } from "./googleAuthService";

test("Google auth state rejects expired payloads", () => {
  const service = new GoogleAuthService({
    clientId: "client",
    clientSecret: "secret",
    stateSecret: "state-secret-for-tests"
  });
  const url = new URL(
    service.buildAuthorizeUrl("https://api.coop-ai.dev/v1/auth/google/callback", {
      mode: "login",
      redirect: "https://admin.coop-ai.dev/auth/callback",
      iat: Date.now() - GOOGLE_AUTH_STATE_TTL_MS - 1000
    })
  );
  const state = url.searchParams.get("state");
  assert.ok(state);
  assert.equal(service.parseState(state!), undefined);
});

test("Google auth state accepts fresh payloads", () => {
  const service = new GoogleAuthService({
    clientId: "client",
    clientSecret: "secret",
    stateSecret: "state-secret-for-tests"
  });
  const url = new URL(
    service.buildAuthorizeUrl("https://api.coop-ai.dev/v1/auth/google/callback", {
      mode: "login",
      redirect: "https://admin.coop-ai.dev/auth/callback"
    })
  );
  const state = url.searchParams.get("state");
  assert.ok(state);
  const parsed = service.parseState(state!);
  assert.ok(parsed);
  assert.equal(parsed!.mode, "login");
  assert.equal(parsed!.redirect, "https://admin.coop-ai.dev/auth/callback");
});
