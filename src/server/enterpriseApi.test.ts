import test from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleEnterpriseApiRequest } from "./enterpriseApi";
import type { OrgStore } from "./orgStore";
import type { SsoConfigStore } from "./sso/ssoConfigStore";
import type { AuthPolicyStore } from "./sso/authPolicyStore";
import type { UserStore } from "./users/userStore";
import type { ServerConfig } from "./serverConfig";

function mockResponse(): ServerResponse & { statusCode?: number; body?: unknown } {
  const response = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    writeHead(statusCode: number) {
      this.statusCode = statusCode;
    },
    end(payload: string) {
      this.body = JSON.parse(payload);
    }
  };
  return response as ServerResponse & { statusCode?: number; body?: unknown };
}

const enterpriseOrgId = "org-enterprise-1";

const serverConfig = {
  legacyApiToken: undefined,
  requireApiAuth: true,
  ssoBaseUrl: "https://api.coop-ai.dev",
  ssoSpEntityId: undefined,
  ssoSessionTtlMs: 43_200_000
} as ServerConfig;

function mockOrgStore(): OrgStore {
  return {
    resolveAuth: async () => ({
      orgId: enterpriseOrgId,
      orgName: "Acme",
      plan: "enterprise",
      apiKeyId: "key-1",
      role: "admin",
      userId: "user-1"
    }),
    getOrganization: async (orgId: string) =>
      orgId === enterpriseOrgId
        ? { id: orgId, name: "Acme", plan: "enterprise", createdAt: new Date() }
        : undefined,
    isOrgSuspended: async () => false
  } as unknown as OrgStore;
}

function mockSsoConfigStore(): SsoConfigStore {
  let saved:
    | {
        provider: "okta";
        idpEntityId: string;
        idpSsoUrl: string;
        idpX509Cert: string;
        enabled: boolean;
      }
    | undefined;

  return {
    getConfig: async () =>
      saved
        ? {
            orgId: enterpriseOrgId,
            provider: saved.provider,
            idpEntityId: saved.idpEntityId,
            idpSsoUrl: saved.idpSsoUrl,
            idpX509Cert: saved.idpX509Cert,
            enabled: saved.enabled,
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-02")
          }
        : undefined,
    getEnabledConfig: async () => {
      const config = saved
        ? {
            orgId: enterpriseOrgId,
            provider: saved.provider,
            idpEntityId: saved.idpEntityId,
            idpSsoUrl: saved.idpSsoUrl,
            idpX509Cert: saved.idpX509Cert,
            enabled: saved.enabled,
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-02")
          }
        : undefined;
      return config?.enabled ? config : undefined;
    },
    upsertConfig: async (_orgId: string, input: {
      provider: string;
      idpEntityId: string;
      idpSsoUrl: string;
      idpX509Cert: string;
      enabled?: boolean;
    }) => {
      saved = {
        provider: input.provider as "okta",
        idpEntityId: input.idpEntityId,
        idpSsoUrl: input.idpSsoUrl,
        idpX509Cert: input.idpX509Cert,
        enabled: input.enabled ?? true
      };
      return {
        orgId: enterpriseOrgId,
        provider: saved.provider,
        idpEntityId: saved.idpEntityId,
        idpSsoUrl: saved.idpSsoUrl,
        idpX509Cert: saved.idpX509Cert,
        enabled: saved.enabled,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-03")
      };
    }
  } as unknown as SsoConfigStore;
}

function mockAuthPolicyStore(): AuthPolicyStore {
  let policy = {
    orgId: enterpriseOrgId,
    requireSso: false,
    allowPassword: true,
    allowGoogle: true,
    updatedAt: new Date("2026-01-01")
  };

  return {
    getPolicy: async () => policy,
    upsertPolicy: async (_orgId: string, input: {
      requireSso?: boolean;
      allowPassword?: boolean;
      allowGoogle?: boolean;
    }) => {
      policy = {
        ...policy,
        requireSso: input.requireSso ?? policy.requireSso,
        allowPassword: input.allowPassword ?? policy.allowPassword,
        allowGoogle: input.allowGoogle ?? policy.allowGoogle,
        updatedAt: new Date("2026-01-04")
      };
      if (policy.requireSso) {
        policy.allowPassword = false;
        policy.allowGoogle = false;
      }
      return policy;
    }
  } as unknown as AuthPolicyStore;
}

const userStore = {} as UserStore;

test("GET /v1/sso/config returns SP details when unconfigured", async () => {
  const response = mockResponse();
  const handled = await handleEnterpriseApiRequest(
    {
      method: "GET",
      pathname: "/v1/sso/config",
      headers: { authorization: "Bearer coop_sess_test" },
      body: undefined
    },
    response,
    {
      orgStore: mockOrgStore(),
      ssoConfigStore: mockSsoConfigStore(),
      authPolicyStore: mockAuthPolicyStore(),
      userStore,
      serverConfig
    }
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    configured: false,
    sp: {
      entityId: "https://api.coop-ai.dev/v1/auth/saml/metadata",
      acsUrl: "https://api.coop-ai.dev/v1/auth/saml/callback",
      metadataUrl: "https://api.coop-ai.dev/v1/auth/saml/metadata",
      publicStartUrl: "https://api.coop-ai.dev/v1/auth/saml/start"
    }
  });
});

const VALID_TEST_CERT = `-----BEGIN CERTIFICATE-----
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
-----END CERTIFICATE-----`;

test("PUT /v1/sso/config saves IdP configuration", async () => {
  const response = mockResponse();
  const handled = await handleEnterpriseApiRequest(
    {
      method: "PUT",
      pathname: "/v1/sso/config",
      headers: { authorization: "Bearer coop_sess_test" },
      body: {
        provider: "okta",
        idpEntityId: "https://idp.example.com/entity",
        idpSsoUrl: "https://idp.example.com/sso",
        idpX509Cert: VALID_TEST_CERT
      }
    },
    response,
    {
      orgStore: mockOrgStore(),
      ssoConfigStore: mockSsoConfigStore(),
      authPolicyStore: mockAuthPolicyStore(),
      userStore,
      serverConfig
    }
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  const body = response.body as {
    configured: boolean;
    provider: string;
    idpEntityId: string;
    hasCertificate: boolean;
  };
  assert.equal(body.configured, true);
  assert.equal(body.provider, "okta");
  assert.equal(body.idpEntityId, "https://idp.example.com/entity");
  assert.equal(body.hasCertificate, true);
});

test("PUT /v1/sso/config rejects session tokens as certificates", async () => {
  const response = mockResponse();
  await handleEnterpriseApiRequest(
    {
      method: "PUT",
      pathname: "/v1/sso/config",
      headers: { authorization: "Bearer coop_sess_test" },
      body: {
        provider: "okta",
        idpEntityId: "https://idp.example.com/entity",
        idpSsoUrl: "https://idp.example.com/sso",
        idpX509Cert: "coop_sess_this_is_not_a_certificate"
      }
    },
    response,
    {
      orgStore: mockOrgStore(),
      ssoConfigStore: mockSsoConfigStore(),
      authPolicyStore: mockAuthPolicyStore(),
      userStore,
      serverConfig
    }
  );

  assert.equal(response.statusCode, 400);
  const body = response.body as { error: string };
  assert.equal(body.error, "invalid_request");
});

test("PUT /v1/sso/config rejects non-HTTPS IdP SSO URLs", async () => {
  const response = mockResponse();
  await handleEnterpriseApiRequest(
    {
      method: "PUT",
      pathname: "/v1/sso/config",
      headers: { authorization: "Bearer coop_sess_test" },
      body: {
        provider: "okta",
        idpEntityId: "https://idp.example.com/entity",
        idpSsoUrl: "http://idp.example.com/sso",
        idpX509Cert: VALID_TEST_CERT
      }
    },
    response,
    {
      orgStore: mockOrgStore(),
      ssoConfigStore: mockSsoConfigStore(),
      authPolicyStore: mockAuthPolicyStore(),
      userStore,
      serverConfig
    }
  );

  assert.equal(response.statusCode, 400);
  const body = response.body as { error: string; message: string };
  assert.equal(body.error, "invalid_request");
  assert.match(body.message, /HTTPS/i);
});

test("PUT /v1/sso/policy rejects requireSso when SSO is not enabled", async () => {
  const response = mockResponse();
  await handleEnterpriseApiRequest(
    {
      method: "PUT",
      pathname: "/v1/sso/policy",
      headers: { authorization: "Bearer coop_sess_test" },
      body: { requireSso: true }
    },
    response,
    {
      orgStore: mockOrgStore(),
      ssoConfigStore: mockSsoConfigStore(),
      authPolicyStore: mockAuthPolicyStore(),
      userStore,
      serverConfig
    }
  );

  assert.equal(response.statusCode, 400);
  const body = response.body as { error: string };
  assert.equal(body.error, "sso_not_configured");
});

test("PUT /v1/sso/config rejects disabling SSO when Require SSO is active", async () => {
  const ssoConfigStore = mockSsoConfigStore();
  const authPolicyStore = mockAuthPolicyStore();

  const configResponse = mockResponse();
  await handleEnterpriseApiRequest(
    {
      method: "PUT",
      pathname: "/v1/sso/config",
      headers: { authorization: "Bearer coop_sess_test" },
      body: {
        provider: "okta",
        idpEntityId: "https://idp.example.com/entity",
        idpSsoUrl: "https://idp.example.com/sso",
        idpX509Cert: VALID_TEST_CERT,
        enabled: true
      }
    },
    configResponse,
    {
      orgStore: mockOrgStore(),
      ssoConfigStore,
      authPolicyStore,
      userStore,
      serverConfig
    }
  );
  assert.equal(configResponse.statusCode, 200);

  const policyResponse = mockResponse();
  await handleEnterpriseApiRequest(
    {
      method: "PUT",
      pathname: "/v1/sso/policy",
      headers: { authorization: "Bearer coop_sess_test" },
      body: { requireSso: true }
    },
    policyResponse,
    {
      orgStore: mockOrgStore(),
      ssoConfigStore,
      authPolicyStore,
      userStore,
      serverConfig
    }
  );
  assert.equal(policyResponse.statusCode, 200);

  const response = mockResponse();
  await handleEnterpriseApiRequest(
    {
      method: "PUT",
      pathname: "/v1/sso/config",
      headers: { authorization: "Bearer coop_sess_test" },
      body: {
        provider: "okta",
        idpEntityId: "https://idp.example.com/entity",
        idpSsoUrl: "https://idp.example.com/sso",
        enabled: false
      }
    },
    response,
    {
      orgStore: mockOrgStore(),
      ssoConfigStore,
      authPolicyStore,
      userStore,
      serverConfig
    }
  );

  assert.equal(response.statusCode, 400);
  const body = response.body as { error: string; message: string };
  assert.equal(body.error, "sso_required_active");
  assert.match(body.message, /Require SSO/i);
});

test("PUT /v1/sso/policy enforces SSO-only sign-in", async () => {
  const ssoConfigStore = mockSsoConfigStore();
  const configResponse = mockResponse();
  await handleEnterpriseApiRequest(
    {
      method: "PUT",
      pathname: "/v1/sso/config",
      headers: { authorization: "Bearer coop_sess_test" },
      body: {
        provider: "okta",
        idpEntityId: "https://idp.example.com/entity",
        idpSsoUrl: "https://idp.example.com/sso",
        idpX509Cert: VALID_TEST_CERT,
        enabled: true
      }
    },
    configResponse,
    {
      orgStore: mockOrgStore(),
      ssoConfigStore,
      authPolicyStore: mockAuthPolicyStore(),
      userStore,
      serverConfig
    }
  );
  assert.equal(configResponse.statusCode, 200);

  const response = mockResponse();
  const handled = await handleEnterpriseApiRequest(
    {
      method: "PUT",
      pathname: "/v1/sso/policy",
      headers: { authorization: "Bearer coop_sess_test" },
      body: { requireSso: true }
    },
    response,
    {
      orgStore: mockOrgStore(),
      ssoConfigStore,
      authPolicyStore: mockAuthPolicyStore(),
      userStore,
      serverConfig
    }
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  const body = response.body as {
    requireSso: boolean;
    allowPassword: boolean;
    allowGoogle: boolean;
  };
  assert.equal(body.requireSso, true);
  assert.equal(body.allowPassword, false);
  assert.equal(body.allowGoogle, false);
});

test("non-enterprise org is rejected for SSO config", async () => {
  const proOrgStore = {
    resolveAuth: async () => ({
      orgId: "org-pro",
      orgName: "Pro Org",
      plan: "pro",
      apiKeyId: "key-2",
      role: "admin",
      userId: "user-2"
    }),
    getOrganization: async (orgId: string) =>
      orgId === "org-pro" ? { id: orgId, name: "Pro Org", plan: "pro", createdAt: new Date() } : undefined,
    isOrgSuspended: async () => false
  } as unknown as OrgStore;

  const response = mockResponse();
  await handleEnterpriseApiRequest(
    {
      method: "GET",
      pathname: "/v1/sso/config",
      headers: { authorization: "Bearer coop_sess_test" },
      body: undefined
    },
    response,
    {
      orgStore: proOrgStore,
      ssoConfigStore: mockSsoConfigStore(),
      authPolicyStore: mockAuthPolicyStore(),
      userStore,
      serverConfig
    }
  );

  assert.equal(response.statusCode, 403);
});

test("GET /v1/sso/config rejects non-admin members", async () => {
  const memberOrgStore = {
    resolveAuth: async () => ({
      orgId: enterpriseOrgId,
      orgName: "Acme",
      plan: "enterprise",
      apiKeyId: "key-member",
      role: "member",
      userId: "user-member"
    }),
    getOrganization: async (orgId: string) =>
      orgId === enterpriseOrgId
        ? { id: orgId, name: "Acme", plan: "enterprise", createdAt: new Date() }
        : undefined,
    isOrgSuspended: async () => false
  } as unknown as OrgStore;

  const response = mockResponse();
  await handleEnterpriseApiRequest(
    {
      method: "GET",
      pathname: "/v1/sso/config",
      headers: { authorization: "Bearer coop_sess_member" },
      body: undefined
    },
    response,
    {
      orgStore: memberOrgStore,
      ssoConfigStore: mockSsoConfigStore(),
      authPolicyStore: mockAuthPolicyStore(),
      userStore,
      serverConfig
    }
  );

  assert.equal(response.statusCode, 403);
  const body = response.body as { error: string };
  assert.equal(body.error, "admin_required");
});
