import assert from "node:assert/strict";
import { createGitHubOAuthService } from "./githubOAuthService";

const service = createGitHubOAuthService("client-id", "client-secret", "state-secret");

const url = service.buildAuthorizeUrl("http://localhost:8787/v1/github/app/callback", "org-123");
assert.ok(url.startsWith("https://github.com/login/oauth/authorize?"));
assert.ok(url.includes("client_id=client-id"));
assert.ok(url.includes("state="));

const state = new URL(url).searchParams.get("state") ?? "";
assert.equal(service.verifyAndParseState(state), "org-123");
assert.equal(service.verifyAndParseState("bad.state.here"), undefined);

console.log("githubOAuthService.test.ts: ok");
