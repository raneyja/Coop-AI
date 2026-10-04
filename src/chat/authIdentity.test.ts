import assert from "node:assert/strict";
import { test } from "node:test";
import { authIdentityKey, shouldRebindAccountThreads } from "./authIdentity";

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

test("unavailable session verification and recovery preserve the bound account thread", () => {
  const boundIdentity = "first@example.test";
  const unavailable = authIdentityKey({ isSignedIn: false });
  assert.equal(shouldRebindAccountThreads(boundIdentity, unavailable, "session-a", "session-a"), false);
  // Recovery compares against the retained binding, not the transient signed-out preferences.
  const recovered = authIdentityKey({ isSignedIn: true, userEmail: boundIdentity });
  assert.equal(shouldRebindAccountThreads(boundIdentity, recovered, "session-a", "session-a"), false);
});

test("confirmed logout or rejected auth still isolates account threads", () => {
  assert.equal(shouldRebindAccountThreads("first@example.test", "", undefined, "session-a"), true);
  assert.equal(shouldRebindAccountThreads("", "", undefined, undefined), false);
});

test("verified sign-in and account switches bind only the verified account", () => {
  assert.equal(shouldRebindAccountThreads("", "first@example.test", "session-a", undefined), true);
  assert.equal(shouldRebindAccountThreads("first@example.test", "second@example.test", "session-b", "session-a"), true);
});

test("changed or never-verified credentials with unavailable verification isolate prior threads", () => {
  assert.equal(shouldRebindAccountThreads("first@example.test", "", "session-b", "session-a"), true);
  assert.equal(shouldRebindAccountThreads("first@example.test", "", "session-a", undefined), true);
});
