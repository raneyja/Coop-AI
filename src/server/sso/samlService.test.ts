import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { SamlService } from "./samlService";
import type { OrgSsoConfig } from "./ssoConfigStore";
import { TEST_IDP_CERT, TEST_IDP_ENTITY_ID, TEST_IDP_SSO_URL, TEST_SAML_BASE_URL,
  createSignedSamlResponse, MemorySamlRequestStore } from "./samlTestFixtures";
import { REVOKED_PUBLIC_CERT } from "./revokedPublicCert.fixture";

export function testSsoConfig(overrides: Partial<OrgSsoConfig> = {}): OrgSsoConfig {
  return { orgId: "org-enterprise-saml-test", provider: "saml", idpEntityId: TEST_IDP_ENTITY_ID,
    idpSsoUrl: TEST_IDP_SSO_URL, idpX509Cert: TEST_IDP_CERT, enabled: true,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"), ...overrides };
}
async function login(config = testSsoConfig()) {
  const store = new MemorySamlRequestStore();
  const service = new SamlService({ baseUrl: TEST_SAML_BASE_URL, requestStore: store });
  const handoff = await service.beginLogin(config, { mode: "login" });
  const relay = new URL(handoff).searchParams.get("RelayState")!;
  const continued = await service.continueLogin(relay);
  const url = new URL(continued.authorizeUrl);
  const xml = inflateRawSync(Buffer.from(url.searchParams.get("SAMLRequest")!, "base64")).toString();
  const requestId = /ID="([^"]+)"/.exec(xml)![1];
  const state = (await service.getLoginState(relay, continued.cookie.split(";")[0]))!;
  return { service, config, state, xml, url, requestId };
}
test("signed correlated callback extracts identity and consumes once", async () => {
  const x = await login(), body = createSignedSamlResponse({ requestId: x.requestId });
  const profile = await x.service.validateCallback(x.config, body, x.state);
  assert.equal(profile.email, "sso-test@demo.local");
  assert.equal(profile.idpProvider, "saml");
  assert.equal(profile.sessionIndex, "session-test-123");
  await x.service.acceptCallback(x.config, body, x.state, async () => profile);
  await assert.rejects(x.service.acceptCallback(x.config, body, x.state, async () => profile), /consumed/);
});
test("ForceAuthn and Azure interactive login preserved", async () => {
  assert.match((await login()).xml, /ForceAuthn="true"/);
  const x = await login(testSsoConfig({ provider: "azuread" }));
  assert.equal(x.url.searchParams.get("prompt"), "login");
  assert.match(x.xml, /ForceAuthn="true"/);
});

test("an existing configuration using the exposed IdP key cannot start SAML login", async () => {
  const service = new SamlService({ baseUrl: TEST_SAML_BASE_URL, requestStore: new MemorySamlRequestStore() });
  await assert.rejects(service.beginLogin(testSsoConfig({ idpX509Cert: REVOKED_PUBLIC_CERT }), { mode: "login" }),
    { name: "SsoConfigError", message: "SAML IdP signing certificate has been revoked" });
});

test("unsigned/tampered callback cannot consume pending state", async () => {
  const x = await login();
  const body = createSignedSamlResponse({ requestId: x.requestId });
  const tampered = Buffer.from(Buffer.from(body, "base64").toString().replace("sso-test@demo.local", "forged@demo.local")).toString("base64");
  await assert.rejects(x.service.validateCallback(x.config, tampered, x.state), /signature/i);
  assert.equal((await x.service.validateCallback(x.config, body, x.state)).email, "sso-test@demo.local");
});
test("wrong trust anchor and unsolicited responses fail", async () => {
  const x = await login();
  await assert.rejects(x.service.validateCallback({ ...x.config, idpX509Cert: "invalid" },
    createSignedSamlResponse({ requestId: x.requestId }), x.state));
  await assert.rejects(x.service.validateCallback(x.config, createSignedSamlResponse(), x.state), /InResponseTo/);
});
test("signed subject request binding cannot be replaced by unsigned envelope", async () => {
  const x = await login();
  await assert.rejects(x.service.validateCallback(x.config,
    createSignedSamlResponse({ requestId: x.requestId, omitSubjectRequestId: true }), x.state), /binding/);
});
