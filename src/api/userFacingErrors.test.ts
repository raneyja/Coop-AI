import assert from "node:assert/strict";
import { formatCoopApiError } from "./userFacingErrors";
import { GITHUB_WRITE_PERMISSION_MESSAGE } from "./codeHosts/pullRequestWrite";

void (async () => {
  const repoLimit = formatCoopApiError(403, {
    error: "repo_limit",
    message: "You've reached the Pro limit of 3 Deep-Indexed Repos per seat."
  });
  assert.match(repoLimit, /plan limit for Deep-Indexed repos/i);
  assert.match(repoLimit, /upgrade to Pro/i);

  const teams503 = formatCoopApiError(503, {
    error: "Teams App is not configured on this server"
  });
  assert.match(teams503, /Microsoft Teams/);
  assert.match(teams503, /TEAMS_APP_CLIENT_ID/);

  const serverMessage = formatCoopApiError(403, {
    error: "custom",
    message: "Teams App is not configured on this server"
  });
  assert.match(serverMessage, /Microsoft Teams/);

  const ssoRequired = formatCoopApiError(403, {
    error: "sso_required",
    message: "Your organization requires SSO sign-in. Use Sign in with SSO."
  });
  assert.match(ssoRequired, /SSO sign-in/i);

  const githubWrite = formatCoopApiError(403, {
    error: GITHUB_WRITE_PERMISSION_MESSAGE
  });
  assert.match(githubWrite, /Contents and Pull requests write/i);

  console.log("userFacingErrors: 1/1 tests passed");
})();
