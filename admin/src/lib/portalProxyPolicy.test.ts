/** Run: cd admin && npx tsx --tsconfig tsconfig.json src/lib/portalProxyPolicy.test.ts */
import assert from "node:assert/strict";
import { isPortalRequest, isSameOriginMutation, portalBackendPath } from "./portalProxyPolicy";

assert.equal(portalBackendPath(["v1", "admin", "users", "user-1"]), "/v1/admin/users/user-1");
assert.equal(portalBackendPath(["v1", "auth", "saml", "metadata"]), "/v1/auth/saml/metadata");
assert.equal(portalBackendPath(["v1", "orgs", "github", "installation"]), "/v1/orgs/github/installation");
for (const path of [
  ["v1", "auth", "logout"],
  ["v1", "orgs", "github", "secret"],
  ["v1", "admin", "..", "auth"],
  ["v1", "admin", "a/b"],
  ["v1", "admin", "a\\b"],
  ["v1", "admin", ""],
  ["v1", "admin", "\n"],
  ["v1", "admin", "%2e%2e"]
]) {
  assert.equal(portalBackendPath(path), null, `Rejected path: ${path.join("/")}`);
}

function request(method: string, headers: Record<string, string> = {}): Request {
  return new Request("https://admin.coop-ai.dev/api/coop/v1/me", { method, headers });
}

assert.equal(isPortalRequest(request("GET", { "x-coop-admin-request": "1", "sec-fetch-site": "same-origin" })), true);
assert.equal(isPortalRequest(request("POST", { "x-coop-admin-request": "1", origin: "https://admin.coop-ai.dev" })), true);
assert.equal(isPortalRequest(request("POST", { "x-coop-admin-request": "1" })), false);
assert.equal(isPortalRequest(request("GET", { "sec-fetch-site": "same-origin" })), false);
assert.equal(isPortalRequest(request("GET", { "x-coop-admin-request": "1", "sec-fetch-site": "cross-site" })), false);
assert.equal(isPortalRequest(request("POST", { "x-coop-admin-request": "1", origin: "https://ops.coop-ai.dev" })), false);
assert.equal(isSameOriginMutation(request("POST", { origin: "https://admin.coop-ai.dev" })), true);
assert.equal(isSameOriginMutation(request("POST")), false);
assert.equal(isSameOriginMutation(request("POST", { origin: "https://ops.coop-ai.dev" })), false);
assert.equal(isSameOriginMutation(request("POST", { origin: "https://admin.coop-ai.dev", "sec-fetch-site": "same-site" })), false);
assert.equal(
  isSameOriginMutation(new Request("http://localhost:38872/api/auth/login", {
    method: "POST",
    headers: { host: "127.0.0.1:38872", origin: "http://127.0.0.1:38872" }
  })),
  true
);

console.log("portalProxyPolicy.test.ts: ok");
