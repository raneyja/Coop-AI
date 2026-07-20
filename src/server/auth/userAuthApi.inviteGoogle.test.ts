import test from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleUserAuthApiRequest, resolveGoogleInviteAcceptance } from "./userAuthApi";
import { GoogleAuthService } from "./googleAuthService";
import type { OrgStore } from "../orgStore";
import type { UserStore } from "../users/userStore";
import type { AuthIdentityStore } from "./authIdentityStore";
import type { AuthTokenStore } from "./authTokenStore";
import type { AuthConfig } from "./authConfig";
import type { ServerConfig } from "../serverConfig";
import type { AuditLogger } from "../audit/auditLogger";

function mockResponse(): ServerResponse & { statusCode?: number; body?: unknown; location?: string } {
  const response = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    location: undefined as string | undefined,
    writeHead(statusCode: number, headers?: Record<string, string>) {
      this.statusCode = statusCode;
      if (headers?.location) {
        this.location = headers.location;
      }
    },
    end(payload?: string) {
      if (payload) {
        this.body = JSON.parse(payload);
      }
    }
  };
  return response as ServerResponse & { statusCode?: number; body?: unknown; location?: string };
}

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

const invitedUser = {
  id: "user-invitee",
  orgId: "org-pro",
  email: "invitee@example.com",
  role: "member" as const,
  createdAt: new Date()
};

function inviteDeps(options: {
  googleSubConflict?: boolean;
  emailOverride?: string;
  consumeCalls?: { count: number };
  createOrgCalls?: { count: number };
  auditActions?: string[];
}): Parameters<typeof handleUserAuthApiRequest>[2] {
  const consumeCalls = options.consumeCalls ?? { count: 0 };
  const createOrgCalls = options.createOrgCalls ?? { count: 0 };
  const auditActions = options.auditActions ?? [];
  const googleAuth = new GoogleAuthService({
    clientId: "google-client",
    clientSecret: "google-secret",
    stateSecret: "state-secret-for-tests"
  });

  return {
    orgStore: {
      getOrganization: async () => ({
        id: "org-pro",
        name: "Pro Org",
        plan: "pro",
        createdAt: new Date()
      }),
      createOrganization: async () => {
        createOrgCalls.count += 1;
        return { id: "org-free", name: "Should not create", plan: "free", createdAt: new Date() };
      }
    } as unknown as OrgStore,
    userStore: {
      getUser: async () => ({
        ...invitedUser,
        email: options.emailOverride ?? invitedUser.email
      }),
      findActiveUserByEmail: async () => undefined,
      createUser: async () => {
        throw new Error("should not create user in invite mode");
      },
      updateUserProfile: async () => undefined,
      createSession: async () => ({
        token: "coop_sess_invite",
        userId: invitedUser.id,
        orgId: invitedUser.orgId,
        expiresAt: new Date(Date.now() + 60_000)
      })
    } as unknown as UserStore,
    authIdentityStore: {
      findGoogleIdentity: async () =>
        options.googleSubConflict
          ? {
              id: "id-other",
              userId: "user-other",
              provider: "google" as const,
              providerSubject: "google-sub-1",
              createdAt: new Date()
            }
          : undefined,
      createGoogleIdentity: async () => ({
        id: "id-google",
        userId: invitedUser.id,
        provider: "google" as const,
        providerSubject: "google-sub-1",
        createdAt: new Date()
      }),
      markEmailVerified: async () => undefined
    } as unknown as AuthIdentityStore,
    authTokenStore: {
      peekToken: async () => ({
        userId: invitedUser.id,
        metadata: { orgName: "Pro Org" }
      }),
      consumeToken: async () => {
        consumeCalls.count += 1;
        return { userId: invitedUser.id, metadata: { orgName: "Pro Org" } };
      },
      createToken: async () => "coop_refresh_invite"
    } as unknown as AuthTokenStore,
    googleAuth,
    authConfig,
    serverConfig,
    auditLogger: {
      record: async (entry: { action: string }) => {
        auditActions.push(entry.action);
      }
    } as unknown as AuditLogger
  };
}

test("resolveGoogleInviteAcceptance succeeds on email match and consumes invite", async () => {
  const consumeCalls = { count: 0 };
  const createOrgCalls = { count: 0 };
  const auditActions: string[] = [];
  const deps = inviteDeps({ consumeCalls, createOrgCalls, auditActions });

  const result = await resolveGoogleInviteAcceptance(
    deps,
    {
      sub: "google-sub-1",
      email: "Invitee@Example.com",
      emailVerified: true,
      name: "Ada Lovelace"
    },
    {
      inviteToken: "invite-token",
      firstName: "Ada",
      lastName: "Lovelace",
      timezone: "America/Los_Angeles"
    }
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.accessToken, "coop_sess_invite");
    assert.equal(result.refreshToken, "coop_refresh_invite");
  }
  assert.equal(consumeCalls.count, 1);
  assert.equal(createOrgCalls.count, 0);
  assert.deepEqual(auditActions, ["auth.invite_accepted"]);
});

test("resolveGoogleInviteAcceptance rejects email mismatch without consuming invite", async () => {
  const consumeCalls = { count: 0 };
  const deps = inviteDeps({ consumeCalls, emailOverride: "invitee@example.com" });

  const result = await resolveGoogleInviteAcceptance(
    deps,
    {
      sub: "google-sub-1",
      email: "other@example.com",
      emailVerified: true
    },
    {
      inviteToken: "invite-token",
      firstName: "Ada",
      lastName: "Lovelace",
      timezone: "America/Los_Angeles"
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "email_mismatch");
    assert.equal(result.status, 403);
  }
  assert.equal(consumeCalls.count, 0);
});

test("resolveGoogleInviteAcceptance rejects google sub linked to another user", async () => {
  const consumeCalls = { count: 0 };
  const deps = inviteDeps({ consumeCalls, googleSubConflict: true });

  const result = await resolveGoogleInviteAcceptance(
    deps,
    {
      sub: "google-sub-1",
      email: "invitee@example.com",
      emailVerified: true
    },
    {
      inviteToken: "invite-token",
      firstName: "Ada",
      lastName: "Lovelace",
      timezone: "America/Los_Angeles"
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "google_identity_conflict");
    assert.equal(result.status, 409);
  }
  assert.equal(consumeCalls.count, 0);
});

test("google/exchange invite email mismatch returns accept-invite redirect", async () => {
  const consumeCalls = { count: 0 };
  const deps = inviteDeps({ consumeCalls });
  const googleAuth = deps.googleAuth!;
  const signedState = new URL(
    googleAuth.buildAuthorizeUrl("https://admin.coop-ai.dev/api/auth/google/callback", {
      mode: "invite",
      inviteToken: "invite-token",
      firstName: "Ada",
      lastName: "Lovelace",
      timezone: "America/Los_Angeles",
      redirect: "https://admin.coop-ai.dev/auth/callback"
    })
  ).searchParams.get("state")!;

  const originalExchange = googleAuth.exchangeCode.bind(googleAuth);
  googleAuth.exchangeCode = async () => ({
    sub: "google-sub-1",
    email: "wrong@example.com",
    emailVerified: true,
    name: "Wrong User"
  });

  const response = mockResponse();
  const handled = await handleUserAuthApiRequest(
    {
      method: "POST",
      pathname: "/v1/auth/google/exchange",
      headers: {},
      body: {
        code: "auth-code",
        state: signedState,
        redirectUri: "https://admin.coop-ai.dev/api/auth/google/callback"
      }
    },
    response,
    deps
  );

  googleAuth.exchangeCode = originalExchange;

  assert.equal(handled, true);
  assert.equal(response.statusCode, 403);
  const body = response.body as { error: string; redirect?: string };
  assert.equal(body.error, "email_mismatch");
  assert.ok(body.redirect);
  assert.match(body.redirect!, /\/accept-invite\?token=invite-token/);
  assert.equal(consumeCalls.count, 0);
});
