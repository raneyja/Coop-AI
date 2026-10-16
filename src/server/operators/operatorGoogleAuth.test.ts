import assert from "node:assert/strict";
import test from "node:test";
import { OperatorGoogleAuthService } from "./operatorGoogleAuth";
import type { OperatorAuthConfig } from "./operatorAuthConfig";
import type { OperatorStore } from "./operatorStore";

const callback = "https://ops.coop-ai.dev/api/auth/google/callback";
const localCallback = "http://localhost:3003/api/auth/google/callback";
const config: OperatorAuthConfig = {
  googleClientId: "test-client",
  googleClientSecret: "test-secret",
  allowlistEmails: new Set(["operator@example.com"]),
  opsPortalUrl: "https://ops.coop-ai.dev",
  sessionTtlMs: 60_000,
  oauthStateSecret: "test-only-state-secret",
  defaultRole: "viewer"
};

test("operator exchange requires signed state for the same allowed callback", async () => {
  const service = new OperatorGoogleAuthService(config);
  const authorize = service.buildAuthorizeUrl(callback, "https://ops.coop-ai.dev/auth/callback");
  assert.ok(authorize);
  const state = new URL(authorize).searchParams.get("state");
  assert.ok(state);
  const deps = { config, operatorStore: {} as OperatorStore };

  for (const [candidateState, candidateCallback] of [
    ["", callback],
    [state.slice(0, -1) + (state.endsWith("a") ? "b" : "a"), callback],
    [state, localCallback]
  ]) {
    const result = await service.exchangeCodeForSession(deps, "synthetic-code", candidateState, candidateCallback);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "invalid_state");
  }

  const originalFetch = globalThis.fetch;
  let exchangeAttempts = 0;
  globalThis.fetch = async () => {
    exchangeAttempts++;
    throw new Error("synthetic Google exchange failure");
  };
  try {
    const valid = await service.exchangeCodeForSession(deps, "synthetic-code", state, callback);
    assert.equal(valid.ok, false);
    if (!valid.ok) assert.equal(valid.error, "google_exchange_failed");
    assert.equal(exchangeAttempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
