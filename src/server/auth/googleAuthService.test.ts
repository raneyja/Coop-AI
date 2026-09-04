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

test("Google auth state round-trips checkout mode fields", () => {
  const service = new GoogleAuthService({
    clientId: "client",
    clientSecret: "secret",
    stateSecret: "state-secret-for-tests"
  });
  const url = new URL(
    service.buildAuthorizeUrl("https://api.coop-ai.dev/v1/auth/google/callback", {
      mode: "checkout",
      usageTier: "pro_plus",
      intent: "team",
      seats: 8,
      orgName: "Acme",
      redirect: "http://localhost:3003/signup?tier=pro_plus&for=team"
    })
  );
  const state = url.searchParams.get("state");
  assert.ok(state);
  const parsed = service.parseState(state!);
  assert.ok(parsed);
  assert.equal(parsed!.mode, "checkout");
  assert.equal(parsed!.usageTier, "pro_plus");
  assert.equal(parsed!.intent, "team");
  assert.equal(parsed!.seats, 8);
  assert.equal(parsed!.orgName, "Acme");
});

test("Google auth state round-trips invite mode fields", () => {
  const service = new GoogleAuthService({
    clientId: "client",
    clientSecret: "secret",
    stateSecret: "state-secret-for-tests"
  });
  const url = new URL(
    service.buildAuthorizeUrl("https://api.coop-ai.dev/v1/auth/google/callback", {
      mode: "invite",
      inviteToken: "invite-token-abc",
      firstName: "Ada",
      lastName: "Lovelace",
      timezone: "America/Los_Angeles",
      redirect: "https://admin.coop-ai.dev/auth/callback"
    })
  );
  const state = url.searchParams.get("state");
  assert.ok(state);
  const parsed = service.parseState(state!);
  assert.ok(parsed);
  assert.equal(parsed!.mode, "invite");
  assert.equal(parsed!.inviteToken, "invite-token-abc");
  assert.equal(parsed!.firstName, "Ada");
  assert.equal(parsed!.lastName, "Lovelace");
  assert.equal(parsed!.timezone, "America/Los_Angeles");
});
