import assert from "node:assert/strict";
import test from "node:test";
import { loadAuthConfig, loadGoogleOAuthCredentials } from "./authConfig";

test("loadGoogleOAuthCredentials prefers GOOGLE_AUTH when both pairs are set", () => {
  const creds = loadGoogleOAuthCredentials({
    GOOGLE_AUTH_CLIENT_ID: "auth-id.apps.googleusercontent.com",
    GOOGLE_AUTH_CLIENT_SECRET: "auth-secret",
    GOOGLE_DOCS_APP_CLIENT_ID: "docs-id.apps.googleusercontent.com",
    GOOGLE_DOCS_APP_CLIENT_SECRET: "docs-secret"
  });
  assert.equal(creds?.source, "GOOGLE_AUTH");
  assert.equal(creds?.clientId, "auth-id.apps.googleusercontent.com");
  assert.equal(creds?.clientSecret, "auth-secret");
});

test("loadGoogleOAuthCredentials uses GOOGLE_DOCS_APP when AUTH pair is incomplete", () => {
  const creds = loadGoogleOAuthCredentials({
    GOOGLE_AUTH_CLIENT_SECRET: "stale-auth-secret",
    GOOGLE_DOCS_APP_CLIENT_ID: "docs-id.apps.googleusercontent.com",
    GOOGLE_DOCS_APP_CLIENT_SECRET: "docs-secret"
  });
  assert.equal(creds?.source, "GOOGLE_DOCS_APP");
  assert.equal(creds?.clientId, "docs-id.apps.googleusercontent.com");
  assert.equal(creds?.clientSecret, "docs-secret");
});

test("loadAuthConfig keeps google client id and secret on the same source", () => {
  const config = loadAuthConfig({
    GOOGLE_DOCS_APP_CLIENT_ID: "docs-id.apps.googleusercontent.com",
    GOOGLE_DOCS_APP_CLIENT_SECRET: "docs-secret"
  });
  assert.equal(config.googleOAuthCredentialSource, "GOOGLE_DOCS_APP");
  assert.equal(config.googleClientId, "docs-id.apps.googleusercontent.com");
  assert.equal(config.googleClientSecret, "docs-secret");
});
