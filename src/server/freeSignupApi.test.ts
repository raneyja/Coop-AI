import test from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleFreeSignupApiRequest } from "./freeSignupApi";

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

const authConfig = {
  publicBaseUrl: "http://localhost:8787",
  oauthStateSecret: "test",
  accessTtlMs: 3600000,
  refreshTtlMs: 86400000,
  passwordMinLength: 12,
  marketingBaseUrl: "http://localhost:3001",
  adminPortalUrl: "http://localhost:3001"
};

test("free signup creates org, owner, session, and sends welcome email", async () => {
  const previousAdminPortalUrl = process.env.COOP_ADMIN_PORTAL_URL;
  process.env.COOP_ADMIN_PORTAL_URL = "https://admin.coop-ai.dev";

  const created: { orgName?: string; plan?: string; ownerEmail?: string } = {};
  const orgStore = {
    createOrganization: async (name: string, plan: "free" | "pro" | "enterprise") => {
      created.orgName = name;
      created.plan = plan;
      return { id: "org-1", name, plan: "free", createdAt: new Date() };
    }
  };
  const userStore = {
    findActiveUserByEmail: async () => undefined,
    createUser: async (_orgId: string, email: string, role: string) => {
      created.ownerEmail = email;
      return { id: "user-1", orgId: "org-1", email, role, createdAt: new Date() };
    },
    createSession: async () => ({
      token: "coop_sess_test",
      userId: "user-1",
      orgId: "org-1",
      expiresAt: new Date(Date.now() + 3600000)
    })
  };
  const authIdentityStore = {
    createPasswordIdentity: async () => ({ id: "id-1", userId: "user-1", provider: "password", createdAt: new Date() })
  };
  const authTokenStore = {
    createToken: async () => "coop_refresh_test"
  };
  let welcomeEmail:
    | {
        to: string;
        orgName: string;
        adminPortalUrl: string;
      }
    | undefined;
  const emailService = {
    sendFreeSignupWelcome: async (payload: { to: string; orgName: string; adminPortalUrl: string }) => {
      welcomeEmail = payload;
    },
    sendEmailVerification: async () => undefined
  };

  const response = mockResponse();
  const handled = await handleFreeSignupApiRequest(
    {
      method: "POST",
      pathname: "/v1/signup/free",
      body: { email: "Owner@Example.com", password: "validpassword12" }
    },
    response,
    {
      orgStore: orgStore as never,
      userStore: userStore as never,
      authIdentityStore: authIdentityStore as never,
      authTokenStore: authTokenStore as never,
      emailService: emailService as never,
      authConfig
    }
  );

  if (previousAdminPortalUrl === undefined) {
    delete process.env.COOP_ADMIN_PORTAL_URL;
  } else {
    process.env.COOP_ADMIN_PORTAL_URL = previousAdminPortalUrl;
  }

  assert.equal(handled, true);
  assert.equal(response.statusCode, 201);
  assert.equal(created.plan, "free");
  assert.equal(created.orgName, "owner");
  assert.equal(created.ownerEmail, "owner@example.com");
  assert.deepEqual(welcomeEmail, {
    to: "owner@example.com",
    orgName: "owner",
    adminPortalUrl: "https://admin.coop-ai.dev/login"
  });
  const body = response.body as Record<string, unknown>;
  assert.equal(body.orgId, "org-1");
  assert.equal(body.accessToken, "coop_sess_test");
  assert.equal(body.refreshToken, "coop_refresh_test");
  assert.equal(body.apiKey, undefined);
});

test("free signup rejects invalid email", async () => {
  const response = mockResponse();
  const handled = await handleFreeSignupApiRequest(
    {
      method: "POST",
      pathname: "/v1/signup/free",
      body: { email: "invalid-email", password: "validpassword12" }
    },
    response,
    {
      orgStore: {} as never,
      userStore: {} as never,
      authIdentityStore: {} as never,
      authTokenStore: {} as never,
      emailService: {} as never,
      authConfig
    }
  );
  assert.equal(handled, true);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error: "invalid_email",
    message: "Enter a valid email address."
  });
});

test("free signup rejects existing active email", async () => {
  let createdOrganization = false;
  const orgStore = {
    createOrganization: async () => {
      createdOrganization = true;
      throw new Error("should not be called");
    }
  };
  const userStore = {
    findActiveUserByEmail: async () => ({
      id: "user-1",
      orgId: "org-1",
      email: "owner@example.com",
      role: "owner",
      createdAt: new Date()
    })
  };
  const response = mockResponse();
  const handled = await handleFreeSignupApiRequest(
    {
      method: "POST",
      pathname: "/v1/signup/free",
      body: { email: "owner@example.com", orgName: "Acme", password: "validpassword12" }
    },
    response,
    {
      orgStore: orgStore as never,
      userStore: userStore as never,
      authIdentityStore: {} as never,
      authTokenStore: {} as never,
      emailService: {} as never,
      authConfig
    }
  );
  assert.equal(handled, true);
  assert.equal(response.statusCode, 409);
  assert.equal(createdOrganization, false);
  assert.deepEqual(response.body, {
    error: "signup_rate_limited",
    code: "email_taken",
    message: "This email already has a Coop AI account. Sign in or reset your password."
  });
});

test("free signup rejects weak password", async () => {
  const response = mockResponse();
  const handled = await handleFreeSignupApiRequest(
    {
      method: "POST",
      pathname: "/v1/signup/free",
      body: { email: "owner@example.com", password: "short" }
    },
    response,
    {
      orgStore: {} as never,
      userStore: { findActiveUserByEmail: async () => undefined } as never,
      authIdentityStore: {} as never,
      authTokenStore: {} as never,
      emailService: {} as never,
      authConfig
    }
  );
  assert.equal(handled, true);
  assert.equal(response.statusCode, 400);
  assert.equal((response.body as { error?: string }).error, "weak_password");
});
