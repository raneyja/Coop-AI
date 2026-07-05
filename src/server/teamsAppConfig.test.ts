import assert from "node:assert/strict";
import test from "node:test";
import {
  describeTeamsAppConfigProblem,
  loadTeamsAppConfig,
  looksLikeAzureClientId,
  looksLikeAzureClientSecret
} from "./teamsAppConfig";

test("looksLikeAzureClientSecret detects secret shape", () => {
  assert.equal(looksLikeAzureClientSecret("jVw8Q~JChNSc~BVw4dfpQ-SNc_GvIEhNhy2DSaa_"), true);
  assert.equal(looksLikeAzureClientSecret("12345678-abcd-ef01-2345-6789abcdef01"), false);
});

test("looksLikeAzureClientId accepts UUID", () => {
  assert.equal(looksLikeAzureClientId("12345678-abcd-ef01-2345-6789abcdef01"), true);
  assert.equal(looksLikeAzureClientId("jVw8Q~secret"), false);
});

test("describeTeamsAppConfigProblem flags swapped client id", () => {
  const problem = describeTeamsAppConfigProblem({
    TEAMS_APP_CLIENT_ID: "jVw8Q~JChNSc~BVw4dfpQ-SNc_GvIEhNhy2DSaa_",
    TEAMS_APP_CLIENT_SECRET: "12345678-abcd-ef01-2345-6789abcdef01"
  });
  assert.match(problem ?? "", /TEAMS_APP_CLIENT_ID/);
  assert.match(problem ?? "", /UUID/);
});

test("loadTeamsAppConfig rejects swapped credentials", () => {
  const config = loadTeamsAppConfig({
    TEAMS_APP_CLIENT_ID: "jVw8Q~JChNSc~BVw4dfpQ-SNc_GvIEhNhy2DSaa_",
    TEAMS_APP_CLIENT_SECRET: "12345678-abcd-ef01-2345-6789abcdef01",
    COOP_PUBLIC_BASE_URL: "https://api.coop-ai.dev"
  });
  assert.equal(config, undefined);
});

test("loadTeamsAppConfig accepts valid credentials", () => {
  const config = loadTeamsAppConfig({
    TEAMS_APP_CLIENT_ID: "12345678-abcd-ef01-2345-6789abcdef01",
    TEAMS_APP_CLIENT_SECRET: "jVw8Q~JChNSc~BVw4dfpQ-SNc_GvIEhNhy2DSaa_",
    COOP_PUBLIC_BASE_URL: "https://api.coop-ai.dev"
  });
  assert.equal(config?.clientId, "12345678-abcd-ef01-2345-6789abcdef01");
});
