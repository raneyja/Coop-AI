import assert from "node:assert/strict";
import {
  resolveOAuthSuccessRedirectUrl,
  resolveGithubConnectSuccessRedirectUrl
} from "./oauthCallbackRedirect";

assert.equal(
  resolveOAuthSuccessRedirectUrl("http://localhost:8787", "atlassian=connected"),
  undefined
);

assert.equal(
  resolveOAuthSuccessRedirectUrl("https://api.coop-ai.dev", "slack=connected"),
  "https://coop-ai.dev/docs?slack=connected"
);

assert.equal(
  resolveGithubConnectSuccessRedirectUrl({ COOP_ADMIN_PORTAL_URL: "https://admin.coop-ai.dev" }),
  "https://admin.coop-ai.dev/integrations?github=connected"
);

console.log("oauthCallbackRedirect: ok");
