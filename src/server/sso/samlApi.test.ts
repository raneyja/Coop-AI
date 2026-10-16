import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { handleSamlApiRequest, type SamlApiDeps } from "./samlApi";
import { SamlService } from "./samlService";
import type { OrgStore } from "../orgStore";
import type { SsoConfigStore, OrgSsoConfig } from "./ssoConfigStore";
import type { UserStore } from "../users/userStore";
import type { ServerConfig } from "../serverConfig";
import type { AuthConfig } from "../auth/authConfig";
import { TEST_IDP_CERT, TEST_IDP_ENTITY_ID, TEST_IDP_SSO_URL, TEST_SAML_BASE_URL,
  createSignedSamlResponse, MemorySamlRequestStore, startSamlHttpServer } from "./samlTestFixtures";


function fixture() {
  const orgId = "org-enterprise-saml-callback";
  const config: OrgSsoConfig = { orgId, provider: "saml", idpEntityId: TEST_IDP_ENTITY_ID,
    idpSsoUrl: TEST_IDP_SSO_URL, idpX509Cert: TEST_IDP_CERT, enabled: true,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02") };
  const effects = { users: 0, sessions: 0 };
  const deps: SamlApiDeps = {
    orgStore: { getOrganization: async (id: string) => id === orgId
      ? { id, name: "SSO", plan: "enterprise" } : undefined, isOrgSuspended: async () => false } as unknown as OrgStore,
    ssoConfigStore: { getEnabledConfig: async () => config } as unknown as SsoConfigStore,
    userStore: { upsertUserFromIdp: async () => { effects.users++; return { id: "user", orgId, email: "sso-test@demo.local" }; },
      createSession: async () => { effects.sessions++; return { token: "coop_sess_fixture" }; } } as unknown as UserStore,
    samlService: new SamlService({ baseUrl: TEST_SAML_BASE_URL, requestStore: new MemorySamlRequestStore() }),
    serverConfig: { requireApiAuth: true, ssoSessionTtlMs: 43200000 } as ServerConfig,
    authConfig: { adminPortalUrl: "https://admin.coop-ai.dev", marketingBaseUrl: "https://coop-ai.dev" } as AuthConfig
  };
  return { deps, orgId, effects };
}
async function startLogin(base: string, orgId: string, mode = "login", redirect = "https://admin.coop-ai.dev/auth/callback") {
  const response = await fetch(`${base}/v1/auth/saml/start?${new URLSearchParams({ orgId, mode, redirect, format: "json" })}`);
  assert.equal(response.status, 200);
  const continueUrl = new URL((await response.json() as { redirectUrl: string }).redirectUrl);
  const continued = await fetch(`${base}${continueUrl.pathname}${continueUrl.search}`, { redirect: "manual" });
  assert.equal(continued.status, 302);
  const authorize = new URL(continued.headers.get("location")!);
  const xml = inflateRawSync(Buffer.from(authorize.searchParams.get("SAMLRequest")!, "base64")).toString();
  return { relay: authorize.searchParams.get("RelayState")!, cookie: continued.headers.get("set-cookie")!.split(";")[0],
    requestId: /ID="([^"]+)"/.exec(xml)![1] };
}
async function callback(base: string, login: { relay: string; cookie: string }, body?: string) {
  return fetch(`${base}/v1/auth/saml/callback`, { method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: login.cookie },
    body: new URLSearchParams({ RelayState: login.relay, ...(body ? { SAMLResponse: body } : {}) }) });
}
for (const mode of ["login", "test"]) {
  test(`HTTP ${mode} callback binds start/continue, preserves redirect and mode`, async () => {
    const x = fixture(), server = await startSamlHttpServer(x.deps);
    try {
      const redirect = mode === "test" ? "https://admin.coop-ai.dev/settings/single-sign-on" : "https://admin.coop-ai.dev/auth/callback";
      const login = await startLogin(server.base, x.orgId, mode, redirect);
      const response = await callback(server.base, login, createSignedSamlResponse({ requestId: login.requestId }));
      assert.equal(response.status, 302);
      const result = new URL(response.headers.get("location")!);
      assert.equal(result.origin + result.pathname, redirect);
      assert.equal(mode === "test" ? result.searchParams.get("sso_test") : result.hash.includes("coopToken="), mode === "test" ? "passed" : true);
      assert.deepEqual(x.effects, mode === "test" ? { users: 0, sessions: 0 } : { users: 1, sessions: 1 });
    } finally { await server.close(); }
  });
  test(`HTTP ${mode} invalid assertion reveals generic error and does not consume`, async () => {
    const x = fixture(), server = await startSamlHttpServer(x.deps);
    try {
      const login = await startLogin(server.base, x.orgId, mode);
      const response = await callback(server.base, login, Buffer.from("<Response/>").toString("base64"));
      assert.equal(response.status, 302);
      const result = new URL(response.headers.get("location")!);
      assert.equal(result.searchParams.get("error"), "saml_validation_failed");
      assert.match(result.searchParams.get("message")!, /could not be verified/);
      assert.deepEqual(x.effects, { users: 0, sessions: 0 });
      assert.equal((await callback(server.base, login, createSignedSamlResponse({ requestId: login.requestId }))).status, 302);
    } finally { await server.close(); }
  });
}
test("HTTP missing response and forged legacy relay fail without identity effects", async () => {
  const x = fixture(), server = await startSamlHttpServer(x.deps);
  try {
    const login = await startLogin(server.base, x.orgId);
    const missing = await callback(server.base, login);
    assert.equal(missing.status, 302);
    assert.equal(new URL(missing.headers.get("location")!).searchParams.get("error"), "missing_saml_response");
    assert.equal((await callback(server.base, { ...login, relay: Buffer.from(JSON.stringify({ orgId: x.orgId })).toString("base64url") }, createSignedSamlResponse())).status, 400);
    assert.deepEqual(x.effects, { users: 0, sessions: 0 });
  } finally { await server.close(); }
});
