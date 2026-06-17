import assert from "node:assert/strict";
import { resolveOAuthSuccessRedirectUrl } from "./oauthCallbackRedirect";

assert.equal(
  resolveOAuthSuccessRedirectUrl("http://localhost:8787", "atlassian=connected"),
  undefined
);

assert.equal(
  resolveOAuthSuccessRedirectUrl("https://api.coop-ai.dev", "slack=connected"),
  "https://coop-ai.dev/docs?slack=connected"
);

console.log("oauthCallbackRedirect: ok");
