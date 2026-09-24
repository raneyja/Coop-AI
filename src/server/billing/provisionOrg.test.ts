import test from "node:test";
import assert from "node:assert/strict";
import { OrgStore } from "../orgStore";
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
    getOrganization: async () => ({
      id: "other-org",
      name: "Other",
      plan: "pro" as const,
      createdAt: new Date()
    }),
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

test("Google checkout attaches Google identity and skips password invite", async () => {
  const created: { userId?: string; googleSub?: string } = {};
  const orgStore = {
    findOrganizationByStripeCustomerId: async () => undefined,
    createOrganization: async (name: string) => ({
      id: "org-g",
      name,
      plan: "pro" as const,
      createdAt: new Date()
    }),
    updateOrganizationBilling: async () => undefined
  };
  const userStore = {
    findActiveUserByEmail: async () => undefined,
    createUser: async () => ({
      id: "user-g",
      orgId: "org-g",
      email: "buyer@gmail.com",
      role: "admin" as const,
      createdAt: new Date()
    })
  };
  const authIdentityStore = {
    createGoogleIdentity: async (userId: string, googleSub: string) => {
      created.userId = userId;
      created.googleSub = googleSub;
      return { id: "id-g", userId, provider: "google" as const, createdAt: new Date() };
    }
  };
  let welcome: { activateAccountUrl?: string } | undefined;
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
      adminEmail: "buyer@gmail.com",
      seatCount: 1,
      stripeCustomerId: "cus_g",
      stripeSubscriptionId: "sub_g",
      googleSub: "google-sub-1"
    },
    {
      createToken: async () => {
        throw new Error("should not mint password invite for Google checkout");
      }
    } as never,
    authIdentityStore as never
  );

  assert.equal(created.userId, "user-g");
  assert.equal(created.googleSub, "google-sub-1");
  assert.equal(welcome?.activateAccountUrl, undefined);
});

test("replay checkout keeps one org and one admin for the stripe customer", async () => {
  const orgs: Array<{ id: string; name: string; stripeCustomerId?: string }> = [];
  const users: Array<{ id: string; orgId: string; email: string }> = [];
  let creates = 0;
  const orgStore = {
    findOrganizationByStripeCustomerId: async (customerId: string) =>
      orgs.find((org) => org.stripeCustomerId === customerId),
    createOrganization: async (name: string) => {
      creates += 1;
      const org = { id: "org-replay", name, plan: "pro" as const, createdAt: new Date() };
      orgs.push(org);
      return org;
    },
    updateOrganizationBilling: async (orgId: string, patch: { stripeCustomerId?: string | null }) => {
      const org = orgs.find((row) => row.id === orgId);
      if (org && patch.stripeCustomerId) {
        org.stripeCustomerId = patch.stripeCustomerId;
      }
    }
  };
  const userStore = {
    findActiveUserByEmail: async (email: string) => users.find((user) => user.email === email),
    findOrgUserByEmail: async (orgId: string, email: string) =>
      users.find((user) => user.orgId === orgId && user.email === email),
    createUser: async (orgId: string, email: string) => {
      const user = {
        id: `user-${users.length + 1}`,
        orgId,
        email,
        role: "admin" as const,
        createdAt: new Date()
      };
      users.push(user);
      return user;
    }
  };
  const input = {
    orgName: "Acme",
    adminEmail: "buyer@example.com",
    seatCount: 3,
    stripeCustomerId: "cus_replay",
    stripeSubscriptionId: "sub_replay"
  };
  const run = () =>
    provisionOrgFromCheckout(
      orgStore as never,
      userStore as never,
      { sendWelcome: async () => undefined } as never,
      billingConfig as never,
      input,
      { createToken: async () => "coop_invite_replay" } as never
    );

  const first = await run();
  const second = await run();
  assert.equal(first.orgId, "org-replay");
  assert.equal(second.orgId, "org-replay");
  assert.equal(creates, 1);
  assert.equal(orgs.length, 1);
  assert.equal(users.length, 1);
});

test("retry after admin insert failure finishes the same org without a second admin", async () => {
  const orgs: Array<{ id: string; name: string; stripeCustomerId?: string }> = [];
  const users: Array<{ id: string; orgId: string; email: string }> = [];
  let failUser = true;
  const orgStore = {
    findOrganizationByStripeCustomerId: async (customerId: string) =>
      orgs.find((org) => org.stripeCustomerId === customerId),
    createOrganization: async (name: string) => {
      const org = { id: "org-partial", name, plan: "pro" as const, createdAt: new Date() };
      orgs.push(org);
      return org;
    },
    updateOrganizationBilling: async (orgId: string, patch: { stripeCustomerId?: string | null }) => {
      const org = orgs.find((row) => row.id === orgId);
      if (org && patch.stripeCustomerId) {
        org.stripeCustomerId = patch.stripeCustomerId;
      }
    }
  };
  const userStore = {
    findActiveUserByEmail: async (email: string) => users.find((user) => user.email === email),
    findOrgUserByEmail: async (orgId: string, email: string) =>
      users.find((user) => user.orgId === orgId && user.email === email),
    createUser: async (orgId: string, email: string) => {
      if (failUser) {
        failUser = false;
        throw new Error("user insert failed");
      }
      const user = { id: "user-partial", orgId, email, role: "admin" as const, createdAt: new Date() };
      users.push(user);
      return user;
    }
  };
  const input = {
    orgName: "Acme",
    adminEmail: "buyer@example.com",
    seatCount: 1,
    stripeCustomerId: "cus_partial",
    stripeSubscriptionId: "sub_partial"
  };
  await assert.rejects(() =>
    provisionOrgFromCheckout(
      orgStore as never,
      userStore as never,
      { sendWelcome: async () => undefined } as never,
      billingConfig as never,
      input,
      { createToken: async () => "tok" } as never
    )
  );
  const result = await provisionOrgFromCheckout(
    orgStore as never,
    userStore as never,
    { sendWelcome: async () => undefined } as never,
    billingConfig as never,
    input,
    { createToken: async () => "tok" } as never
  );
  assert.equal(result.orgId, "org-partial");
  assert.equal(orgs.length, 1);
  assert.equal(users.length, 1);
});

test("checkout org insert stores the stripe customer id in the same statement", async () => {
  const sqls: string[] = [];
  const pool = {
    query: async (sql: string) => {
      sqls.push(sql);
      if (sql.includes("INSERT INTO organizations")) {
        return {
          rows: [
            {
              id: "org-atomic",
              name: "Acme",
              plan: "pro",
              created_at: new Date().toISOString(),
              usage_tier: "pro"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };
  const store = new OrgStore(pool as never);
  const org = await store.createOrganizationForCheckout({
    name: "Acme",
    billingEmail: "buyer@example.com",
    stripeCustomerId: "cus_atomic",
    stripeSubscriptionId: "sub_atomic",
    seatCount: 2,
    usageTier: "pro",
    stripePriceId: "price_pro",
    seatInventory: { pro: 2, pro_plus: 0, max: 0 }
  });
  assert.equal(org.id, "org-atomic");
  assert.equal(sqls.length, 1);
  assert.match(sqls[0] ?? "", /stripe_customer_id/);
});

test("duplicate stripe customer insert returns the existing org", async () => {
  let inserts = 0;
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("INSERT INTO organizations")) {
        inserts += 1;
        const error = new Error("duplicate key") as Error & { code?: string };
        error.code = "23505";
        throw error;
      }
      if (sql.includes("stripe_customer_id")) {
        return {
          rows: [
            {
              id: "org-existing",
              name: "Acme",
              plan: "pro",
              created_at: new Date().toISOString(),
              usage_tier: "pro"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };
  const store = new OrgStore(pool as never);
  const org = await store.createOrganizationForCheckout({
    name: "Acme",
    billingEmail: "buyer@example.com",
    stripeCustomerId: "cus_existing",
    stripeSubscriptionId: "sub_existing",
    seatCount: 1,
    usageTier: "pro",
    seatInventory: { pro: 1, pro_plus: 0, max: 0 }
  });
  assert.equal(inserts, 1);
  assert.equal(org.id, "org-existing");
});

test("paid checkout attaches an existing free org instead of creating another", async () => {
  let plan: string | undefined;
  let billing: { stripeCustomerId?: string; billingStatus?: string; seatCount?: number; usageTier?: string } | undefined;
  let created = 0;
  const orgStore = {
    findOrganizationByStripeCustomerId: async () => undefined,
    getOrganization: async () => ({
      id: "org-free",
      name: "jonathanaraney",
      plan: "free" as const,
      createdAt: new Date()
    }),
    setOrganizationPlan: async (_orgId: string, next: string) => {
      plan = next;
    },
    updateOrganizationBilling: async (
      _orgId: string,
      patch: { stripeCustomerId?: string; billingStatus?: string; seatCount?: number; usageTier?: string }
    ) => {
      billing = patch;
    },
    createOrganization: async () => {
      created += 1;
      throw new Error("should not create a second org");
    }
  };
  const userStore = {
    findActiveUserByEmail: async () => ({
      id: "user-free",
      orgId: "org-free",
      email: "buyer@example.com",
      role: "admin" as const,
      createdAt: new Date()
    }),
    backfillOrgUsersUsageTier: async () => 1,
    createUser: async () => {
      throw new Error("should not create a user");
    }
  };

  const result = await provisionOrgFromCheckout(
    orgStore as never,
    userStore as never,
    { sendProUpgradeWelcome: async () => undefined } as never,
    billingConfig as never,
    {
      orgName: "jonathanaraney",
      adminEmail: "buyer@example.com",
      seatCount: 1,
      stripeCustomerId: "cus_free_attach",
      stripeSubscriptionId: "sub_free_attach"
    }
  );

  assert.equal(result.orgId, "org-free");
  assert.equal(plan, "pro");
  assert.equal(billing?.stripeCustomerId, "cus_free_attach");
  assert.equal(billing?.billingStatus, "active");
  assert.equal(billing?.seatCount, 1);
  assert.equal(billing?.usageTier, "pro");
  assert.equal(created, 0);
});

test("email failure after the org is saved still leaves the org pro and linked", async () => {
  let plan: string | undefined;
  let billing: { stripeCustomerId?: string; stripeSubscriptionId?: string; billingStatus?: string } | undefined;
  const orgStore = {
    getOrganization: async () => ({
      id: "org-free",
      name: "jonathanaraney",
      plan: "free" as const,
      createdAt: new Date()
    }),
    setOrganizationPlan: async (_orgId: string, next: string) => {
      plan = next;
    },
    updateOrganizationBilling: async (
      _orgId: string,
      patch: { stripeCustomerId?: string; stripeSubscriptionId?: string; billingStatus?: string }
    ) => {
      billing = patch;
    }
  };
  const userStore = {
    backfillOrgUsersUsageTier: async () => 1
  };
  const emailService = {
    sendProUpgradeWelcome: async () => {
      throw new Error("resend down");
    }
  };

  const result = await provisionOrgFromCheckout(
    orgStore as never,
    userStore as never,
    emailService as never,
    billingConfig as never,
    {
      orgName: "jonathanaraney",
      adminEmail: "buyer@example.com",
      seatCount: 1,
      stripeCustomerId: "cus_email_fail",
      stripeSubscriptionId: "sub_email_fail",
      existingOrgId: "org-free",
      upgrade: true
    }
  );

  assert.equal(result.orgId, "org-free");
  assert.equal(plan, "pro");
  assert.equal(billing?.stripeCustomerId, "cus_email_fail");
  assert.equal(billing?.stripeSubscriptionId, "sub_email_fail");
  assert.equal(billing?.billingStatus, "active");
});
