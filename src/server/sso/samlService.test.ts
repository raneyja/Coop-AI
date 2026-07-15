import test from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { SamlService, SsoConfigError } from "./samlService";
import type { OrgSsoConfig } from "./ssoConfigStore";
import {
  TEST_IDP_CERT,
  TEST_IDP_ENTITY_ID,
  TEST_IDP_SSO_URL,
  TEST_SAML_BASE_URL,
  createSignedSamlResponse
} from "./samlTestFixtures";

const enterpriseOrgId = "org-enterprise-saml-test";

function testSsoConfig(overrides: Partial<OrgSsoConfig> = {}): OrgSsoConfig {
  return {
    orgId: enterpriseOrgId,
    provider: "saml",
    idpEntityId: TEST_IDP_ENTITY_ID,
    idpSsoUrl: TEST_IDP_SSO_URL,
    idpX509Cert: TEST_IDP_CERT,
    enabled: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    ...overrides
  };
}

const samlService = new SamlService({ baseUrl: TEST_SAML_BASE_URL });

test("validateCallback accepts a signed assertion and extracts identity", async () => {
  const email = "sso-callback@demo.local";
  const samlResponse = createSignedSamlResponse({ email });

  const assertion = await samlService.validateCallback(testSsoConfig(), samlResponse);

  assert.equal(assertion.email, email);
  assert.equal(assertion.idpSubject, email);
  assert.equal(assertion.idpProvider, "saml");
  assert.equal(assertion.sessionIndex, "session-test-123");
});

test("getLoginRedirectUrl requests ForceAuthn from the IdP", async () => {
  const url = await samlService.getLoginRedirectUrl(testSsoConfig(), "relay-state-test");
  const parsed = new URL(url);
  const samlRequest = parsed.searchParams.get("SAMLRequest");
  assert.ok(samlRequest, "expected SAMLRequest query param");
  const xml = inflateRawSync(Buffer.from(samlRequest, "base64")).toString("utf8");
  assert.match(xml, /ForceAuthn="true"/);
});

test("getLoginRedirectUrl adds prompt=login for Azure AD", async () => {
  const url = await samlService.getLoginRedirectUrl(
    testSsoConfig({ provider: "azuread" }),
    "relay-state-azure"
  );
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("prompt"), "login");
  const samlRequest = parsed.searchParams.get("SAMLRequest");
  assert.ok(samlRequest);
  const xml = inflateRawSync(Buffer.from(samlRequest!, "base64")).toString("utf8");
  assert.match(xml, /ForceAuthn="true"/);
});

test("validateCallback rejects an unsigned assertion", async () => {
  const unsigned = Buffer.from(
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status></samlp:Response>`,
    "utf8"
  ).toString("base64");

  await assert.rejects(
    () => samlService.validateCallback(testSsoConfig(), unsigned),
    (error: unknown) => error instanceof Error && error.message.length > 0
  );
});

test("validateCallback rejects assertion signed with wrong IdP cert", async () => {
  const samlResponse = createSignedSamlResponse({ email: "wrong-cert@demo.local" });
  const wrongCertConfig = testSsoConfig({
    idpX509Cert: `-----BEGIN CERTIFICATE-----
MIIC4jCCAcoCCQC33wnybT5QZDANBgkqhkiG9w0BAQsFADAyMQswCQYDVQQGEwJV
SzEPMA0GA1UECgwGQm94eUhRMRIwEAYDVQQDDAlNb2NrIFNBTUwwIBcNMjIwMjI4
MjE0NjM4WhgPMzAyMTA3MDEyMTQ2MzhaMDIxCzAJBgNVBAYTAlVLMQ8wDQYDVQQK
DAZCb3h5SFExEjAQBgNVBAMMCU1vY2sgU0FNTDCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBALGfYettMsct1T6tVUwTudNJH5Pnb9GGnkXi9Zw/e6x45DD0
RuRONbFlJ2T4RjAE/uG+AjXxXQ8o2SZfb9+GgmCHuTJFNgHoZ1nFVXCmb/Hg8Hpd
4vOAGXndixaReOiq3EH5XvpMjMkJ3+8+9VYMzMZOjkgQtAqO36eAFFfNKX7dTj3V
pwLkvz6/KFCq8OAwY+AUi4eZm5J57D31GzjHwfjH9WTeX0MyndmnNB1qV75qQR3b
2/W5sGHRv+9AarggJkF+ptUkXoLtVA51wcfYm6hILptpde5FQC8RWY1YrswBWAEZ
NfyrR4JeSweElNHg4NVOs4TwGjOPwWGqzTfgTlECAwEAATANBgkqhkiG9w0BAQsF
AAOCAQEAAYRlYflSXAWoZpFfwNiCQVE5d9zZ0DPzNdWhAybXcTyMf0z5mDf6FWBW
5Gyoi9u3EMEDnzLcJNkwJAAc39Apa4I2/tml+Jy29dk8bTyX6m93ngmCgdLh5Za4
khuU3AM3L63g7VexCuO7kwkjh/+LqdcIXsVGO6XDfu2QOs1Xpe9zIzLpwm/RNYeX
UjbSj5ce/jekpAw7qyVVL4xOyh8AtUW1ek3wIw1MJvEgEPt0d16oshWJpoS1OT8L
r/22SvYEo3EmSGdTVGgk3x3s+A0qWAqTcyjr7Q4s/GKYRFfomGwz0TZ4Iw1ZN99M
m0eo2USlSRTVl7QHRTuiuSThHpLKQQ==
-----END CERTIFICATE-----`
  });

  await assert.rejects(
    () => samlService.validateCallback(wrongCertConfig, samlResponse),
    (error: unknown) => error instanceof Error && !(error instanceof SsoConfigError)
  );
});
