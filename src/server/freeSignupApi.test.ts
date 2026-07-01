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

test("free signup creates org, owner, key, and sends welcome email with api key", async () => {
  const previousAdminPortalUrl = process.env.COOP_ADMIN_PORTAL_URL;
  process.env.COOP_ADMIN_PORTAL_URL = "https://admin.coop-ai.dev";

  const created: { orgName?: string; plan?: string; ownerEmail?: string; keyLabel?: string } = {};
  const orgStore = {
    createOrganization: async (name: string, plan: "free" | "pro" | "enterprise") => {
      created.orgName = name;
      created.plan = plan;
      return { id: "org-1", name, plan: "free", createdAt: new Date() };
    },
    createApiKey: async (_orgId: string, label: string) => {
      created.keyLabel = label;
      return {
        record: { id: "key-1", orgId: "org-1", label, createdAt: new Date() },
        rawKey: "coop_test_raw_key"
      };
    }
  };
  const userStore = {
    findActiveUserByEmail: async () => undefined,
    createUser: async (_orgId: string, email: string, role: string) => {
      created.ownerEmail = email;
      return { id: "user-1", orgId: "org-1", email, role, createdAt: new Date() };
    }
  };
  let emailed:
    | {
        to: string;
        orgName: string;
        adminPortalUrl: string;
        apiKey: string;
      }
    | undefined;
  const emailService = {
    sendFreeSignupWelcome: async (payload: {
      to: string;
      orgName: string;
      adminPortalUrl: string;
      apiKey: string;
    }) => {
      emailed = payload;
    }
  };

  const response = mockResponse();
  const handled = await handleFreeSignupApiRequest(
    {
      method: "POST",
      pathname: "/v1/signup/free",
      body: { email: "Owner@Example.com" }
    },
    response,
    { orgStore: orgStore as never, userStore: userStore as never, emailService: emailService as never }
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
  assert.equal(created.keyLabel, "admin portal");
  assert.deepEqual(emailed, {
    to: "owner@example.com",
    orgName: "owner",
    adminPortalUrl: "https://admin.coop-ai.dev/login",
    apiKey: "coop_test_raw_key"
  });
  assert.deepEqual(response.body, {
    orgId: "org-1",
    orgName: "owner",
    adminPortalLoginUrl: "https://admin.coop-ai.dev/login",
    apiKey: "coop_test_raw_key"
  });
});

test("free signup rejects invalid email", async () => {
  const response = mockResponse();
  const handled = await handleFreeSignupApiRequest(
    {
      method: "POST",
      pathname: "/v1/signup/free",
      body: { email: "invalid-email" }
    },
    response,
    {
      orgStore: {} as never,
      userStore: {} as never,
      emailService: {} as never
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
      body: { email: "owner@example.com", orgName: "Acme" }
    },
    response,
    {
      orgStore: orgStore as never,
      userStore: userStore as never,
      emailService: {} as never
    }
  );
  assert.equal(handled, true);
  assert.equal(response.statusCode, 429);
  assert.equal(createdOrganization, false);
  assert.deepEqual(response.body, {
    error: "signup_rate_limited",
    code: "email_taken",
    message: "This email already has an active Coop AI account."
  });
});
