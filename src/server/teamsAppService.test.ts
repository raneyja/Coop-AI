import assert from "node:assert/strict";
import { createTeamsAppService } from "./teamsAppService";

const service = createTeamsAppService("client-id", "client-secret", "state-secret-at-least-32-chars!!");

const url = new URL(
  service.buildAuthorizeUrl("http://localhost:8787/v1/teams/app/callback", "org-123")
);

assert.equal(url.origin + url.pathname, "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
assert.equal(url.searchParams.get("client_id"), "client-id");
assert.equal(url.searchParams.get("response_type"), "code");
assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8787/v1/teams/app/callback");
assert.ok(url.searchParams.get("scope")?.includes("ChannelMessage.Read.All"));
assert.equal(url.searchParams.get("prompt"), "select_account consent");
assert.ok(url.searchParams.get("state"));

console.log("  ✓ Teams authorize URL forces select_account consent");
