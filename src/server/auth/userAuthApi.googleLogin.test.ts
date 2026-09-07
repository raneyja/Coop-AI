import test from "node:test";
import assert from "node:assert/strict";
import { resolveGoogleUser } from "./userAuthApi";
import type { OrgStore } from "../orgStore";
import type { UserStore } from "../users/userStore";
import type { AuthIdentityStore } from "./authIdentityStore";
import type { AuthTokenStore } from "./authTokenStore";
import type { AuthConfig } from "./authConfig";
import type { ServerConfig } from "../serverConfig";
import type { UserAuthApiDeps } from "./userAuthApi";

const authConfig = {
  publicBaseUrl: "https://api.coop-ai.dev",
  marketingBaseUrl: "https://coop-ai.dev",
  adminPortalUrl: "https://admin.coop-ai.dev",
  passwordMinLength: 8,
  googleClientId: "google-client",
  googleClientSecret: "google-secret",
  oauthStateSecret: "state-secret-for-tests",
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

const existingUser = {
  id: "user-paid",
  orgId: "org-pro",
  email: "jon@coop-ai.dev",
  role: "admin" as const,
  createdAt: new Date()
};

function googleDeps(options: {
  existingUser?: typeof existingUser;
  createOrgCalls?: { count: number };
}): UserAuthApiDeps {
  const createOrgCalls = options.createOrgCalls ?? { count: 0 };
  return {
    orgStore: {
      getOrganization: async () => ({
        id: existingUser.orgId,
        name: "Coop",
        plan: "pro",
        createdAt: new Date()
      }),
      createOrganization: async () => {
        createOrgCalls.count += 1;
        return { id: "org-free", name: "New Free Org", plan: "free", createdAt: new Date() };
      },
      isOrgSuspended: async () => false
    } as unknown as OrgStore,
    userStore: {
      getUser: async () => options.existingUser,
      findActiveUserByEmail: async () => options.existingUser,
      createUser: async () => ({
        id: "user-free",
        orgId: "org-free",
        email: "jon@coop-ai.dev",
        role: "admin",
        createdAt: new Date()
      }),
      createSession: async () => ({
        token: "coop_sess_login",
        userId: existingUser.id,
        orgId: existingUser.orgId,
        expiresAt: new Date(Date.now() + 60_000)
      })
    } as unknown as UserStore,
    authIdentityStore: {
      findGoogleIdentity: async () => undefined,
      createGoogleIdentity: async () => ({
        id: "id-google",
        userId: existingUser.id,
        provider: "google" as const,
        providerSubject: "google-sub-1",
        createdAt: new Date()
      })
    } as unknown as AuthIdentityStore,
    authTokenStore: {
      createToken: async () => "coop_refresh_login"
    } as unknown as AuthTokenStore,
    authConfig,
    serverConfig
  };
}

const profile = {
  sub: "google-sub-1",
  email: "jon@coop-ai.dev",
  emailVerified: true
};

test("Google login does not create a free org when no Coop user exists", async () => {
  const createOrgCalls = { count: 0 };
  const result = await resolveGoogleUser(googleDeps({ createOrgCalls }), profile, { mode: "login" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "account_not_found");
    assert.equal(result.status, 404);
  }
  assert.equal(createOrgCalls.count, 0);
});

test("Google signup still creates a free org for a new user", async () => {
  const createOrgCalls = { count: 0 };
  const result = await resolveGoogleUser(googleDeps({ createOrgCalls }), profile, { mode: "signup" });
  assert.equal(result.ok, true);
  assert.equal(createOrgCalls.count, 1);
});

test("Google login signs into an existing user without creating an org", async () => {
  const createOrgCalls = { count: 0 };
  const result = await resolveGoogleUser(
    googleDeps({ existingUser, createOrgCalls }),
    profile,
    { mode: "login" }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.accessToken, "coop_sess_login");
  }
  assert.equal(createOrgCalls.count, 0);
});
