import test from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleSamlApiRequest } from "./samlApi";
import { SamlService } from "./samlService";
import type { OrgStore } from "../orgStore";
import type { SsoConfigStore, OrgSsoConfig } from "./ssoConfigStore";
import type { UserStore, UserRecord, CreatedSession } from "../users/userStore";
import type { ServerConfig } from "../serverConfig";
import {
  TEST_IDP_CERT,
  TEST_IDP_ENTITY_ID,
  TEST_IDP_SSO_URL,
  TEST_SAML_BASE_URL,
  createSignedSamlResponse
} from "./samlTestFixtures";

const enterpriseOrgId = "org-enterprise-saml-callback";

const serverConfig = {
  legacyApiToken: undefined,
  requireApiAuth: true,
  ssoBaseUrl: TEST_SAML_BASE_URL,
  ssoSpEntityId: undefined,
  ssoSessionTtlMs: 43_200_000
} as ServerConfig;

function mockRedirectResponse(): {
  response: ServerResponse;
  state: { statusCode?: number; location?: string; body?: string };
} {
  const state: { statusCode?: number; location?: string; body?: string } = {};
  const response = {
    writeHead(statusCode: number, headers?: Record<string, string>) {
      state.statusCode = statusCode;
      state.location = headers?.location;
    },
    end(payload?: string) {
      state.body = payload;
    }
  } as ServerResponse;
  return { response, state };
}

function encodeRelayState(orgId: string, redirect?: string): string {
  return Buffer.from(JSON.stringify({ orgId, redirect }), "utf8").toString("base64url");
}

function testSsoConfig(): OrgSsoConfig {
  return {
    orgId: enterpriseOrgId,
    provider: "saml",
    idpEntityId: TEST_IDP_ENTITY_ID,
    idpSsoUrl: TEST_IDP_SSO_URL,
    idpX509Cert: TEST_IDP_CERT,
    enabled: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02")
  };
}

function mockOrgStore(): OrgStore {
  return {
    getOrganization: async (orgId: string) =>
      orgId === enterpriseOrgId
        ? { id: orgId, name: "SSO Callback Test", plan: "enterprise", createdAt: new Date() }
        : undefined,
    isOrgSuspended: async () => false
  } as unknown as OrgStore;
}

function mockSsoConfigStore(): SsoConfigStore {
  const config = testSsoConfig();
  return {
    getEnabledConfig: async (orgId: string) => (orgId === enterpriseOrgId ? config : undefined)
  } as unknown as SsoConfigStore;
}

function mockUserStore(): UserStore {
  const user: UserRecord = {
    id: "user-saml-callback",
    orgId: enterpriseOrgId,
    email: "sso-callback@demo.local",
    role: "member",
    createdAt: new Date("2026-01-01")
  };
  const session: CreatedSession = {
    token: "coop_sess_saml_callback_test_token",
    userId: user.id,
    orgId: enterpriseOrgId,
    expiresAt: new Date(Date.now() + 43_200_000)
  };

  return {
    upsertUserFromIdp: async (login: { orgId: string; email: string; idpProvider: string }) => {
      assert.equal(login.orgId, enterpriseOrgId);
      assert.equal(login.email, user.email);
      assert.equal(login.idpProvider, "saml");
      return user;
    },
    createSession: async (userId: string, orgId: string) => {
      assert.equal(userId, user.id);
      assert.equal(orgId, enterpriseOrgId);
      return session;
    }
  } as unknown as UserStore;
}

function callbackFormBody(samlResponse: string, relayState: string): string {
  return new URLSearchParams({ SAMLResponse: samlResponse, RelayState: relayState }).toString();
}

test("POST /v1/auth/saml/callback delivers session token on valid signed assertion", async () => {
  const redirect = "https://admin.coop-ai.dev/auth/callback";
  const relayState = encodeRelayState(enterpriseOrgId, redirect);
  const samlResponse = createSignedSamlResponse({ email: "sso-callback@demo.local" });
  const { response, state } = mockRedirectResponse();

  const handled = await handleSamlApiRequest(
    {
      method: "POST",
      pathname: "/v1/auth/saml/callback",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: undefined,
      rawBody: callbackFormBody(samlResponse, relayState)
    },
    response,
    {
      orgStore: mockOrgStore(),
      userStore: mockUserStore(),
      ssoConfigStore: mockSsoConfigStore(),
      samlService: new SamlService({ baseUrl: TEST_SAML_BASE_URL }),
      serverConfig
    }
  );

  assert.equal(handled, true);
  assert.equal(state.statusCode, 302);
  const location = new URL(state.location!);
  assert.equal(location.origin + location.pathname, redirect);
  assert.equal(location.hash.includes("coopToken=coop_sess_saml_callback_test_token"), true);
});

test("POST /v1/auth/saml/callback redirects saml_validation_failed for invalid assertion", async () => {
  const redirect = "https://admin.coop-ai.dev/auth/callback";
  const relayState = encodeRelayState(enterpriseOrgId, redirect);
  const invalidResponse = Buffer.from("<samlp:Response/>", "utf8").toString("base64");
  const { response, state } = mockRedirectResponse();

  await handleSamlApiRequest(
    {
      method: "POST",
      pathname: "/v1/auth/saml/callback",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: undefined,
      rawBody: callbackFormBody(invalidResponse, relayState)
    },
    response,
    {
      orgStore: mockOrgStore(),
      userStore: mockUserStore(),
      ssoConfigStore: mockSsoConfigStore(),
      samlService: new SamlService({ baseUrl: TEST_SAML_BASE_URL }),
      serverConfig
    }
  );

  assert.equal(state.statusCode, 302);
  const location = new URL(state.location!);
  assert.equal(location.pathname, "/login");
  assert.equal(location.searchParams.get("error"), "saml_validation_failed");
  assert.match(location.searchParams.get("message") ?? "", /.+/);
});

test("POST /v1/auth/saml/callback returns missing_saml_response when body is empty", async () => {
  const relayState = encodeRelayState(enterpriseOrgId);
  const { response, state } = mockRedirectResponse();

  await handleSamlApiRequest(
    {
      method: "POST",
      pathname: "/v1/auth/saml/callback",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: undefined,
      rawBody: new URLSearchParams({ RelayState: relayState }).toString()
    },
    response,
    {
      orgStore: mockOrgStore(),
      userStore: mockUserStore(),
      ssoConfigStore: mockSsoConfigStore(),
      samlService: new SamlService({ baseUrl: TEST_SAML_BASE_URL }),
      serverConfig
    }
  );

  assert.equal(state.statusCode, 400);
  assert.deepEqual(JSON.parse(state.body!), {
    error: "missing_saml_response",
    message: "The identity provider did not return a SAML response."
  });
});

test("POST /v1/auth/saml/callback returns missing_relay_state without org context", async () => {
  const samlResponse = createSignedSamlResponse();
  const { response, state } = mockRedirectResponse();

  await handleSamlApiRequest(
    {
      method: "POST",
      pathname: "/v1/auth/saml/callback",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: undefined,
      rawBody: new URLSearchParams({ SAMLResponse: samlResponse }).toString()
    },
    response,
    {
      orgStore: mockOrgStore(),
      userStore: mockUserStore(),
      ssoConfigStore: mockSsoConfigStore(),
      samlService: new SamlService({ baseUrl: TEST_SAML_BASE_URL }),
      serverConfig
    }
  );

  assert.equal(state.statusCode, 400);
  assert.deepEqual(JSON.parse(state.body!), {
    error: "missing_relay_state",
    message: "SP-initiated login is required (no org in RelayState)."
  });
});
