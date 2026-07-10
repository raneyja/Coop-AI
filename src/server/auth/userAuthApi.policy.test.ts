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
  googleClientSecret: undefined
} as AuthConfig;

const serverConfig = {
  legacyApiToken: undefined,
  requireApiAuth: false,
  ssoBaseUrl: undefined,
  ssoSpEntityId: undefined,
  ssoSessionTtlMs: 43_200_000
} as ServerConfig;

void (async () => {
  const response = mockResponse();
  const handled = await handleUserAuthApiRequest(
    {
      method: "POST",
      pathname: "/v1/auth/login",
      headers: {},
      body: { email: "user@example.com", password: "correct-password" }
    },
    response,
    {
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
        })
      } as unknown as UserStore,
      authIdentityStore: {
        verifyPassword: async () => true
      } as unknown as AuthIdentityStore,
      authTokenStore: {} as AuthTokenStore,
      authConfig,
      serverConfig,
      pool: {
        query: async () => {
          throw new Error("database unavailable");
        }
      } as unknown as Pool
    }
  );

  assert.equal(handled, true);
  assert.equal(response.statusCode, 403);
  const body = response.body as { error: string; message: string };
  assert.equal(body.error, "auth_policy_unavailable");
  assert.match(body.message, /sign-in policy/i);

  console.log("userAuthApi.policy: 1/1 tests passed");
})();
