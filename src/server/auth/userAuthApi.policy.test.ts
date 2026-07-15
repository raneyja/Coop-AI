import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleUserAuthApiRequest } from "./userAuthApi";
import type { OrgStore } from "../orgStore";
import type { UserStore } from "../users/userStore";
import type { AuthIdentityStore } from "./authIdentityStore";
import type { AuthTokenStore } from "./authTokenStore";
import type { AuthConfig } from "./authConfig";
import type { ServerConfig } from "../serverConfig";
import type { Pool } from "pg";
import { resetAuthRateLimitForTests } from "./authRateLimit";

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

const enterpriseOrgId = "org-enterprise-policy";

const authConfig = {
  marketingBaseUrl: "https://coop-ai.dev",
  adminPortalUrl: "https://admin.coop-ai.dev",
  passwordMinLength: 8,
  googleClientId: undefined,
  googleClientSecret: undefined,
  accessTtlMs: 60_000,
  refreshTtlMs: 120_000
} as AuthConfig;

const serverConfig = {
  legacyApiToken: undefined,
  requireApiAuth: false,
  ssoBaseUrl: undefined,
  ssoSpEntityId: undefined,
  ssoSessionTtlMs: 43_200_000
} as ServerConfig;

function enterpriseDeps(overrides: {
  requireSso?: boolean;
  refreshMeta?: Record<string, unknown>;
  poolFail?: boolean;
}): Parameters<typeof handleUserAuthApiRequest>[2] {
  const requireSso = overrides.requireSso ?? false;
  return {
    orgStore: {
      getOrganization: async (orgId: string) =>
        orgId === enterpriseOrgId
          ? { id: orgId, name: "Acme", plan: "enterprise", createdAt: new Date() }
          : undefined
    } as OrgStore,
    userStore: {
      findActiveUserByEmail: async () => ({
        id: "user-1",
        orgId: enterpriseOrgId,
        email: "user@example.com",
        role: "member",
        createdAt: new Date()
      }),
      getUser: async () => ({
        id: "user-1",
        orgId: enterpriseOrgId,
        email: "user@example.com",
        role: "member",
        createdAt: new Date()
      }),
      createSession: async () => ({
        token: "coop_sess_new",
        userId: "user-1",
        orgId: enterpriseOrgId,
        expiresAt: new Date(Date.now() + 60_000)
      })
    } as unknown as UserStore,
    authIdentityStore: {
      verifyPassword: async () => true
    } as unknown as AuthIdentityStore,
    authTokenStore: {
      peekToken: async () => ({
        userId: "user-1",
        metadata: overrides.refreshMeta ?? { authProvider: "password" }
      }),
      markRefreshTokenUsed: async () => undefined,
      createToken: async () => "coop_refresh_new"
    } as unknown as AuthTokenStore,
    authConfig,
    serverConfig,
    pool: overrides.poolFail
      ? ({
          query: async () => {
            throw new Error("database unavailable");
          }
        } as unknown as Pool)
      : ({
          query: async () => ({
            rows: [
              {
                org_id: enterpriseOrgId,
                require_sso: requireSso,
                allow_password: !requireSso,
                allow_google: !requireSso,
                updated_at: new Date()
              }
            ]
          })
        } as unknown as Pool)
  };
}

void (async () => {
  resetAuthRateLimitForTests();

  {
    const response = mockResponse();
    const handled = await handleUserAuthApiRequest(
      {
        method: "POST",
        pathname: "/v1/auth/login",
        headers: {},
        body: { email: "user@example.com", password: "correct-password" }
      },
      response,
      enterpriseDeps({ poolFail: true })
    );
    assert.equal(handled, true);
    assert.equal(response.statusCode, 403);
    assert.equal((response.body as { error: string }).error, "auth_policy_unavailable");
  }

  resetAuthRateLimitForTests();

  {
    const response = mockResponse();
    const handled = await handleUserAuthApiRequest(
      {
        method: "POST",
        pathname: "/v1/auth/login",
        headers: {},
        body: { email: "user@example.com", password: "correct-password" }
      },
      response,
      enterpriseDeps({ requireSso: true })
    );
    assert.equal(handled, true);
    assert.equal(response.statusCode, 403);
    assert.equal((response.body as { error: string }).error, "sso_required");
  }

  resetAuthRateLimitForTests();

  {
    const response = mockResponse();
    const handled = await handleUserAuthApiRequest(
      {
        method: "POST",
        pathname: "/v1/auth/refresh",
        headers: {},
        body: { refreshToken: "coop_refresh_old" }
      },
      response,
      enterpriseDeps({ requireSso: true, refreshMeta: { authProvider: "password" } })
    );
    assert.equal(handled, true);
    assert.equal(response.statusCode, 403);
    assert.equal((response.body as { error: string }).error, "sso_required");
  }

  console.log("userAuthApi.policy: 3/3 tests passed");
})();
