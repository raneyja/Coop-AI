import assert from "node:assert/strict";
import { loadOperatorAuthConfig } from "./operatorAuthConfig";

void (async () => {
  const config = loadOperatorAuthConfig({
    GOOGLE_AUTH_CLIENT_ID: "auth-id.apps.googleusercontent.com",
    GOOGLE_AUTH_CLIENT_SECRET: "auth-secret",
    COOP_OPS_PORTAL_URL: "http://localhost:3003",
    COOP_OPERATOR_ALLOWLIST_EMAILS: "ops@coop-ai.dev"
  });

  assert.equal(config.googleClientId, "auth-id.apps.googleusercontent.com");
  assert.equal(config.googleClientSecret, "auth-secret");
  assert.equal(config.googleOAuthCredentialSource, "GOOGLE_AUTH");
  assert.equal(config.opsPortalUrl, "http://localhost:3003");
  assert.ok(config.allowlistEmails.has("ops@coop-ai.dev"));

  const override = loadOperatorAuthConfig({
    COOP_OPERATOR_GOOGLE_CLIENT_ID: "ops-id.apps.googleusercontent.com",
    COOP_OPERATOR_GOOGLE_CLIENT_SECRET: "ops-secret",
    GOOGLE_AUTH_CLIENT_ID: "auth-id.apps.googleusercontent.com",
    GOOGLE_AUTH_CLIENT_SECRET: "auth-secret"
  });
  assert.equal(override.googleClientId, "ops-id.apps.googleusercontent.com");

  console.log("operatorAuthConfig.test.ts: ok");
})();
