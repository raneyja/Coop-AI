import assert from "node:assert/strict";
import test from "node:test";
import { resolveGoogleAuthClientRedirect } from "./googleAuthRedirect";

const fallback = "https://admin.coop-ai.dev/auth/callback";

test("accepts Coop editor callbacks", () => {
  assert.equal(
    resolveGoogleAuthClientRedirect("vscode://coop-ai.coop-ai/auth/callback", fallback),
    "vscode://coop-ai.coop-ai/auth/callback"
  );
  assert.equal(
    resolveGoogleAuthClientRedirect("cursor://coop-ai.coop-ai/auth/callback", fallback),
    "cursor://coop-ai.coop-ai/auth/callback"
  );
});

test("rejects unrelated callback targets", () => {
  assert.equal(resolveGoogleAuthClientRedirect("https://evil.example/steal", fallback), fallback);
  assert.equal(resolveGoogleAuthClientRedirect("vscode://another.extension/auth/callback", fallback), fallback);
  assert.equal(resolveGoogleAuthClientRedirect("javascript:alert(1)", fallback), fallback);
});
