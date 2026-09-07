import assert from "node:assert/strict";
import { test } from "node:test";
import { authIdentityKey } from "./authIdentity";

test("authIdentityKey is empty when signed out", () => {
  assert.equal(authIdentityKey({ isSignedIn: false, hasApiKey: false }), "");
  assert.equal(authIdentityKey({ hasApiKey: false }), "");
});

test("authIdentityKey prefers email when signed in", () => {
  assert.equal(
    authIdentityKey({ isSignedIn: true, userEmail: "  Jon@Coop-AI.dev " }),
    "jon@coop-ai.dev"
  );
});

test("authIdentityKey falls back when signed in without email", () => {
  assert.equal(authIdentityKey({ isSignedIn: true }), "signed-in");
  assert.equal(authIdentityKey({ hasApiKey: true }), "signed-in");
});
