import test from "node:test";
import assert from "node:assert/strict";
import { provisionOrgFromCheckout } from "./provisionOrg";

const billingConfig = {
  adminPortalUrl: "https://admin.coop-ai.dev",
  emailMock: true,
  emailFrom: "CoopAI <hello@coop-ai.dev>",
  resendApiKey: "",
  stripeSecretKey: "",
  stripeWebhookSecret: "",
  stripePriceIdPro: "",
  marketingBaseUrl: "https://coop-ai.dev"
} as const;

test("new Pro checkout mints activate-account invite and emails it", async () => {
  const orgStore = {
    findOrganizationByStripeCustomerId: async () => undefined,
    createOrganization: async (name: string) => ({
      id: "org-1",
      name,
      plan: "pro" as const,
      createdAt: new Date()
    }),
    updateOrganizationBilling: async () => undefined
  };
  const userStore = {
    findActiveUserByEmail: async () => undefined,
    createUser: async () => ({
      id: "user-1",
      orgId: "org-1",
      email: "buyer@example.com",
      role: "admin" as const,
      createdAt: new Date()
    })
  };
  const tokens: Array<{ userId: string; purpose: string; metadata?: Record<string, unknown> }> = [];
  const authTokenStore = {
    createToken: async (
      userId: string,
      purpose: string,
      _ttlMs: number,
      metadata?: Record<string, unknown>
    ) => {
      tokens.push({ userId, purpose, metadata });
      return "coop_invite_testtoken";
    }
  };
  let welcome:
    | {
        to: string;
        orgName: string;
        adminPortalUrl: string;
        activateAccountUrl?: string;
      }
    | undefined;
  const emailService = {
    sendWelcome: async (params: typeof welcome) => {
      welcome = params;
    }
  };

  const result = await provisionOrgFromCheckout(
    orgStore as never,
    userStore as never,
    emailService as never,
    billingConfig as never,
    {
      orgName: "Acme",
      adminEmail: "buyer@example.com",
      seatCount: 5,
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test"
    },
    authTokenStore as never
  );

  assert.equal(result.orgId, "org-1");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]?.purpose, "user_invite");
  assert.deepEqual(tokens[0]?.metadata, { orgName: "Acme", source: "checkout" });
  assert.equal(welcome?.activateAccountUrl, "https://admin.coop-ai.dev/accept-invite?token=coop_invite_testtoken");
  assert.match(welcome?.adminPortalUrl ?? "", /\/login\?/);
});

test("existing checkout email user gets sign-in welcome without activate link", async () => {
  const orgStore = {
    findOrganizationByStripeCustomerId: async () => undefined,
    createOrganization: async (name: string) => ({
      id: "org-2",
      name,
      plan: "pro" as const,
      createdAt: new Date()
    }),
    updateOrganizationBilling: async () => undefined
  };
  const userStore = {
    findActiveUserByEmail: async () => ({
      id: "user-existing",
      orgId: "other-org",
      email: "buyer@example.com",
      role: "admin" as const,
      createdAt: new Date()
    }),
    createUser: async () => {
      throw new Error("should not create user");
    }
  };
  let welcome:
    | {
        activateAccountUrl?: string;
      }
    | undefined;
  const emailService = {
    sendWelcome: async (params: typeof welcome) => {
      welcome = params;
    }
  };

  await provisionOrgFromCheckout(
    orgStore as never,
    userStore as never,
    emailService as never,
    billingConfig as never,
    {
      orgName: "Acme",
      adminEmail: "buyer@example.com",
      seatCount: 5,
      stripeCustomerId: "cus_test2",
      stripeSubscriptionId: "sub_test2"
    },
    {
      createToken: async () => {
        throw new Error("should not mint invite");
      }
    } as never
  );

  assert.equal(welcome?.activateAccountUrl, undefined);
});
