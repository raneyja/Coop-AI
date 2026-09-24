import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleBillingApiRequest, usageTierForStripePrice, type BillingApiDeps } from "./billingApi";
import type { AuthContext, OrgStore } from "../orgStore";
import type { ServerConfig } from "../serverConfig";
import { StripeRequestError, type StripeService, type StripeSubscription } from "./stripeService";
import type { BillingConfig } from "./billingConfig";

function mockSubscription(quantity: number, itemId = "si_123"): StripeSubscription {
  return {
    id: "sub_123",
    status: "active",
    quantity,
    itemId,
    items: [{ id: itemId, quantity, priceId: "price_pro" }]
  };
}

function freshClaimPool(): NonNullable<BillingApiDeps["pool"]> {
  const statusById = new Map<string, string>();
  return {
    query: async (sql: string, params?: unknown[]) => {
      const id = String(params?.[0] ?? "");
      if (sql.includes("INSERT INTO stripe_webhook_events")) {
        if (statusById.has(id)) {
          return { rowCount: 0, rows: [] };
        }
        statusById.set(id, "processing");
        return { rowCount: 1, rows: [{ event_id: id }] };
      }
      if (sql.includes("SET status = 'processing'")) {
        if (statusById.get(id) === "failed") {
          statusById.set(id, "processing");
          return { rowCount: 1, rows: [{ event_id: id }] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (sql.includes("SET status = 'completed'")) {
        if (statusById.get(id) === "processing") {
          statusById.set(id, "completed");
        }
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("SET status = 'failed'")) {
        if (statusById.get(id) === "processing") {
          statusById.set(id, "failed");
        }
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("SELECT status")) {
        const status = statusById.get(id);
        return { rowCount: status ? 1 : 0, rows: status ? [{ status }] : [] };
      }
      return { rowCount: 0, rows: [] };
    }
  } as NonNullable<BillingApiDeps["pool"]>;
}

function mockResponse(): ServerResponse & { statusCode?: number; body?: string } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    writeHead(code: number) {
      this.statusCode = code;
    },
    end(payload: string) {
      this.body = payload;
    }
  };
  return res as ServerResponse & { statusCode?: number; body?: string };
}

const adminAuth: AuthContext = {
  orgId: "org-1",
  orgName: "Acme Corp",
  plan: "pro",
  apiKeyId: "key-admin"
};

type BillingRecord = {
  seatCount?: number;
  billingStatus?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
};

function baseDeps(overrides: {
  billing?: BillingRecord | null;
  stripe?: Partial<StripeService>;
  onMutate?: () => void;
}): BillingApiDeps {
  const serverConfig = { requireApiAuth: true } as ServerConfig;
  const stripe = {
    isConfigured: () => true,
    retrieveSubscription: async () => mockSubscription(2),
    createBillingPortalSession: async () => ({ url: "https://billing.stripe.com/session/seat-increase" }),
    ...overrides.stripe
  } as unknown as StripeService;

  return {
    serverConfig,
    stripeService: stripe,
    orgStore: {
      resolveAuth: async () => adminAuth,
      getOrganizationBilling: async () => overrides.billing ?? null,
      updateOrganizationBilling: async () => {
        overrides.onMutate?.();
      },
      setOrganizationPlan: async () => {
        overrides.onMutate?.();
      }
    } as unknown as OrgStore
  };
}

async function seatIncrease(
  deps: BillingApiDeps,
  body: { seats?: unknown; addSeats?: unknown; tier?: unknown }
) {
  const response = mockResponse();
  const handled = await handleBillingApiRequest(
    {
      method: "POST",
      pathname: "/v1/admin/billing/seat-increase",
      headers: { authorization: "Bearer admin-token" },
      body,
      rawBody: Buffer.from("")
    },
    response,
    deps
  );
  assert.equal(handled, true);
  return response;
}

void (async () => {
  const activeBilling: BillingRecord = {
    seatCount: 3,
    billingStatus: "active",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123"
  };

  // Reject a decrease (absolute seats).
  {
    const res = await seatIncrease(baseDeps({ billing: activeBilling }), { seats: 2 });
    assert.equal(res.statusCode, 400);
    assert.match(res.body ?? "", /seats_not_increased/);
  }

  // Reject the same seat count (absolute).
  {
    const res = await seatIncrease(baseDeps({ billing: activeBilling }), { seats: 3 });
    assert.equal(res.statusCode, 400);
    assert.match(res.body ?? "", /seats_not_increased/);
  }

  // Reject a non-integer / non-positive request.
  {
    const res = await seatIncrease(baseDeps({ billing: activeBilling }), { seats: "not-a-number" });
    assert.equal(res.statusCode, 400);
    assert.match(res.body ?? "", /invalid_seats/);
  }
  {
    const res = await seatIncrease(baseDeps({ billing: activeBilling }), { addSeats: 0 });
    assert.equal(res.statusCode, 400);
    assert.match(res.body ?? "", /invalid_seats/);
  }
  {
    const res = await seatIncrease(baseDeps({ billing: activeBilling }), {});
    assert.equal(res.statusCode, 400);
    assert.match(res.body ?? "", /invalid_seats/);
  }

  // Reject when the org has no Stripe subscription.
  {
    const res = await seatIncrease(
      baseDeps({ billing: { seatCount: 3, stripeCustomerId: "cus_123" } }),
      { addSeats: 5 }
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body ?? "", /no_stripe_subscription/);
  }
  {
    const res = await seatIncrease(baseDeps({ billing: null }), { addSeats: 5 });
    assert.equal(res.statusCode, 400);
    assert.match(res.body ?? "", /no_stripe_subscription/);
  }

  // Success (absolute): Stripe confirm URL; no Coop seat mutation when already in sync.
  {
    let mutated = false;
    let sentQuantity: number | undefined;
    const res = await seatIncrease(
      baseDeps({
        billing: activeBilling,
        onMutate: () => {
          mutated = true;
        },
        stripe: {
          retrieveSubscription: async () => mockSubscription(3),
          createBillingPortalSession: async (_customerId: string, options?: { quantity?: number }) => {
            sentQuantity = options?.quantity;
            return { url: "https://billing.stripe.com/session/seat-increase" };
          }
        }
      }),
      { seats: 7 }
    );
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body ?? "{}");
    assert.match(payload.url, /billing\.stripe\.com/);
    assert.equal(payload.currentSeats, 3);
    assert.equal(payload.requestedSeats, 7);
    assert.equal(payload.addedSeats, 4);
    assert.equal(sentQuantity, 7);
    assert.equal(mutated, false, "seat count must not be mutated before webhook when in sync");
  }

  // Success (additive): addSeats is relative to max(coop, stripe).
  {
    let sentQuantity: number | undefined;
    const res = await seatIncrease(
      baseDeps({
        billing: { ...activeBilling, seatCount: 1 },
        stripe: {
          retrieveSubscription: async () => mockSubscription(5),
          createBillingPortalSession: async (_customerId: string, options?: { quantity?: number }) => {
            sentQuantity = options?.quantity;
            return { url: "https://billing.stripe.com/session/seat-increase" };
          }
        }
      }),
      { addSeats: 5 }
    );
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body ?? "{}");
    assert.equal(payload.currentSeats, 5);
    assert.equal(payload.addedSeats, 5);
    assert.equal(payload.requestedSeats, 10);
    assert.equal(sentQuantity, 10);
  }

  // Reject absolute seats below Stripe when Coop is behind.
  {
    const res = await seatIncrease(
      baseDeps({
        billing: { ...activeBilling, seatCount: 2 },
        stripe: {
          retrieveSubscription: async () => mockSubscription(5)
        }
      }),
      { seats: 4 }
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body ?? "", /seats_not_increased/);
  }

  // Success when absolute request is above max(coop, stripe); heals Coop when Stripe ahead.
  {
    let healed = false;
    let sentQuantity: number | undefined;
    const res = await seatIncrease(
      baseDeps({
        billing: { ...activeBilling, seatCount: 2 },
        onMutate: () => {
          healed = true;
        },
        stripe: {
          retrieveSubscription: async () => mockSubscription(5),
          createBillingPortalSession: async (
            _customerId: string,
            options?: { quantity?: number; configurationId?: string }
          ) => {
            sentQuantity = options?.quantity;
            return { url: "https://billing.stripe.com/session/seat-increase" };
          }
        }
      }),
      { seats: 6 }
    );
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body ?? "{}");
    assert.equal(payload.currentSeats, 5);
    assert.equal(payload.requestedSeats, 6);
    assert.equal(sentQuantity, 6);
    assert.equal(healed, true, "Coop seats should heal up to Stripe quantity");
  }

  // Generic portal-session uses the manage configuration id when configured.
  {
    let sentConfig: string | undefined;
    const deps = baseDeps({
      billing: activeBilling,
      stripe: {
        createBillingPortalSession: async (
          _customerId: string,
          options?: { configurationId?: string }
        ) => {
          sentConfig = options?.configurationId;
          return { url: "https://billing.stripe.com/session/manage" };
        }
      }
    });
    process.env.STRIPE_PORTAL_CONFIG_MANAGE = "bpc_manage_test";
    process.env.STRIPE_PORTAL_CONFIG_SEATS = "bpc_seats_test";
    const response = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/v1/admin/billing/portal-session",
        headers: { authorization: "Bearer admin-token" },
        body: {},
        rawBody: Buffer.from("")
      },
      response,
      deps
    );
    assert.equal(response.statusCode, 200);
    assert.equal(sentConfig, "bpc_manage_test");
    delete process.env.STRIPE_PORTAL_CONFIG_MANAGE;
    delete process.env.STRIPE_PORTAL_CONFIG_SEATS;
  }

  // Non-admin (missing) auth is rejected.
  {
    const deps = baseDeps({ billing: activeBilling });
    (deps.orgStore as unknown as { resolveAuth: () => Promise<undefined> }).resolveAuth = async () => undefined;
    const res = await seatIncrease(deps, { addSeats: 5 });
    assert.equal(res.statusCode, 401);
  }

  {
    const prices = {
      stripePriceIdPro: "price_pro",
      stripePriceIdProPlus: "price_plus",
      stripePriceIdMax: "price_max"
    } as BillingConfig;
    assert.equal(usageTierForStripePrice("price_pro", prices), "pro");
    assert.equal(usageTierForStripePrice("price_plus", prices), "pro_plus");
    assert.equal(usageTierForStripePrice("price_max", prices), "max");
    assert.equal(usageTierForStripePrice("price_unknown", prices), "pro");
    assert.equal(usageTierForStripePrice(undefined, prices), "pro");
  }

  {
    let checkout:
      | {
          priceId?: string;
          usageTier?: string;
          orgName?: string;
          seats?: number;
          intent?: string;
        }
      | undefined;
    const stripe = {
      isConfigured: () => true,
      createCheckoutSession: async (input: {
        priceId?: string;
        usageTier?: string;
        orgName?: string;
        seats?: number;
        intent?: string;
      }) => {
        checkout = input;
        return { id: "cs_test", url: "https://checkout.stripe.com/test" };
      }
    } as unknown as StripeService;
    const prevPro = process.env.STRIPE_PRICE_ID_PRO;
    const prevPlus = process.env.STRIPE_PRICE_ID_PRO_PLUS;
    const prevMax = process.env.STRIPE_PRICE_ID_MAX;
    process.env.STRIPE_PRICE_ID_PRO = "price_pro";
    process.env.STRIPE_PRICE_ID_PRO_PLUS = "price_plus";
    process.env.STRIPE_PRICE_ID_MAX = "price_max";
    const plusRes = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/v1/billing/checkout-session",
        headers: {},
        body: { orgName: "Acme", email: "buyer@example.com", seats: 2, tier: "pro_plus" },
        rawBody: Buffer.from("")
      },
      plusRes,
      { serverConfig: { requireApiAuth: false } as ServerConfig, stripeService: stripe }
    );
    assert.equal(plusRes.statusCode, 200);
    assert.equal(checkout?.priceId, "price_plus");
    assert.equal(checkout?.usageTier, "pro_plus");

    delete process.env.STRIPE_PRICE_ID_PRO_PLUS;
    const missingPlus = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/v1/billing/checkout-session",
        headers: {},
        body: { orgName: "Acme", email: "buyer@example.com", seats: 1, tier: "pro_plus" },
        rawBody: Buffer.from("")
      },
      missingPlus,
      { serverConfig: { requireApiAuth: false } as ServerConfig, stripeService: stripe }
    );
    assert.equal(missingPlus.statusCode, 400);
    assert.match(missingPlus.body ?? "", /tier_unavailable/);

    const proRes = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/v1/billing/checkout-session",
        headers: {},
        body: { orgName: "Acme", email: "buyer@example.com", seats: 1 },
        rawBody: Buffer.from("")
      },
      proRes,
      { serverConfig: { requireApiAuth: false } as ServerConfig, stripeService: stripe }
    );
    assert.equal(proRes.statusCode, 200);
    assert.equal(checkout?.priceId, "price_pro");
    assert.equal(checkout?.usageTier, "pro");

    const individualRes = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/v1/billing/checkout-session",
        headers: {},
        body: { email: "jane.doe@acme.com", tier: "pro", intent: "individual", seats: 99 },
        rawBody: Buffer.from("")
      },
      individualRes,
      { serverConfig: { requireApiAuth: false } as ServerConfig, stripeService: stripe }
    );
    assert.equal(individualRes.statusCode, 200);
    assert.equal(checkout?.orgName, "jane.doe");
    assert.equal(checkout?.seats, 1);
    assert.equal(checkout?.intent, "individual");

    const teamMissingOrg = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/v1/billing/checkout-session",
        headers: {},
        body: { email: "admin@acme.com", seats: 8, tier: "pro", intent: "team" },
        rawBody: Buffer.from("")
      },
      teamMissingOrg,
      { serverConfig: { requireApiAuth: false } as ServerConfig, stripeService: stripe }
    );
    assert.equal(teamMissingOrg.statusCode, 400);
    assert.match(teamMissingOrg.body ?? "", /org_name_required/);

    const teamRes = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/v1/billing/checkout-session",
        headers: {},
        body: { orgName: "Acme", email: "admin@acme.com", seats: 8, tier: "pro", intent: "team" },
        rawBody: Buffer.from("")
      },
      teamRes,
      { serverConfig: { requireApiAuth: false } as ServerConfig, stripeService: stripe }
    );
    assert.equal(teamRes.statusCode, 200);
    assert.equal(checkout?.orgName, "Acme");
    assert.equal(checkout?.seats, 8);
    assert.equal(checkout?.intent, "team");

    const existingRes = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/v1/billing/checkout-session",
        headers: {},
        body: { email: "taken@acme.com", intent: "individual" },
        rawBody: Buffer.from("")
      },
      existingRes,
      {
        serverConfig: { requireApiAuth: false } as ServerConfig,
        stripeService: stripe,
        userStore: {
          findActiveUserByEmail: async () => ({
            id: "user-1",
            orgId: "org-free",
            email: "taken@acme.com"
          })
        } as unknown as BillingApiDeps["userStore"]
      }
    );
    assert.equal(existingRes.statusCode, 409);
    assert.match(existingRes.body ?? "", /account_exists/);

    if (prevPro === undefined) delete process.env.STRIPE_PRICE_ID_PRO;
    else process.env.STRIPE_PRICE_ID_PRO = prevPro;
    if (prevPlus === undefined) delete process.env.STRIPE_PRICE_ID_PRO_PLUS;
    else process.env.STRIPE_PRICE_ID_PRO_PLUS = prevPlus;
    if (prevMax === undefined) delete process.env.STRIPE_PRICE_ID_MAX;
    else process.env.STRIPE_PRICE_ID_MAX = prevMax;
  }

  {
    const billingPatches: Array<Record<string, unknown>> = [];
    let planSet: string | undefined;
    const stripe = {
      isConfigured: () => true,
      verifyWebhookSignature: () => ({
        id: "evt_1",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            customer: "cus_1",
            status: "active",
            items: { data: [{ quantity: 2, price: { id: "price_plus" } }] }
          }
        }
      })
    } as unknown as StripeService;
    const prevPro = process.env.STRIPE_PRICE_ID_PRO;
    const prevPlus = process.env.STRIPE_PRICE_ID_PRO_PLUS;
    process.env.STRIPE_PRICE_ID_PRO = "price_pro";
    process.env.STRIPE_PRICE_ID_PRO_PLUS = "price_plus";
    const response = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/webhooks/stripe",
        headers: { "stripe-signature": "t=1,v1=test" },
        body: {},
        rawBody: Buffer.from("{}")
      },
      response,
      {
        serverConfig: { requireApiAuth: false } as ServerConfig,
        stripeService: stripe,
        pool: freshClaimPool(),
        userStore: {} as never,
        emailService: {} as never,
        orgStore: {
          findOrganizationByStripeCustomerId: async () => ({
            id: "org-1",
            name: "Acme",
            plan: "pro"
          }),
          setOrganizationPlan: async (_id: string, plan: string) => {
            planSet = plan;
          },
          updateOrganizationBilling: async (_id: string, patch: Record<string, unknown>) => {
            billingPatches.push(patch);
          }
        } as unknown as OrgStore
      }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(planSet, "pro");
    assert.equal(billingPatches[0]?.usageTier, "pro_plus");
    assert.equal(billingPatches[0]?.stripePriceId, "price_plus");
    assert.deepEqual(billingPatches[0]?.seatInventory, { pro: 0, pro_plus: 2, max: 0 });
    if (prevPro === undefined) delete process.env.STRIPE_PRICE_ID_PRO;
    else process.env.STRIPE_PRICE_ID_PRO = prevPro;
    if (prevPlus === undefined) delete process.env.STRIPE_PRICE_ID_PRO_PLUS;
    else process.env.STRIPE_PRICE_ID_PRO_PLUS = prevPlus;
  }

  {
    const billingPatches: Array<Record<string, unknown>> = [];
    const stripe = {
      isConfigured: () => true,
      verifyWebhookSignature: () => ({
        id: "evt_mix",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_mix",
            customer: "cus_1",
            status: "active",
            items: {
              data: [
                { quantity: 8, price: { id: "price_pro" } },
                { quantity: 2, price: { id: "price_max" } }
              ]
            }
          }
        }
      })
    } as unknown as StripeService;
    const prevPro = process.env.STRIPE_PRICE_ID_PRO;
    const prevPlus = process.env.STRIPE_PRICE_ID_PRO_PLUS;
    const prevMax = process.env.STRIPE_PRICE_ID_MAX;
    process.env.STRIPE_PRICE_ID_PRO = "price_pro";
    process.env.STRIPE_PRICE_ID_PRO_PLUS = "price_plus";
    process.env.STRIPE_PRICE_ID_MAX = "price_max";
    const response = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/webhooks/stripe",
        headers: { "stripe-signature": "t=1,v1=test" },
        body: {},
        rawBody: Buffer.from("{}")
      },
      response,
      {
        serverConfig: { requireApiAuth: false } as ServerConfig,
        stripeService: stripe,
        pool: freshClaimPool(),
        userStore: {} as never,
        emailService: {} as never,
        orgStore: {
          findOrganizationByStripeCustomerId: async () => ({
            id: "org-1",
            name: "Acme",
            plan: "pro",
            usageTier: "pro"
          }),
          setOrganizationPlan: async () => undefined,
          updateOrganizationBilling: async (_id: string, patch: Record<string, unknown>) => {
            billingPatches.push(patch);
          }
        } as unknown as OrgStore
      }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(billingPatches[0]?.usageTier, "pro");
    assert.equal(billingPatches[0]?.seatCount, 10);
    assert.deepEqual(billingPatches[0]?.seatInventory, { pro: 8, pro_plus: 0, max: 2 });
    if (prevPro === undefined) delete process.env.STRIPE_PRICE_ID_PRO;
    else process.env.STRIPE_PRICE_ID_PRO = prevPro;
    if (prevPlus === undefined) delete process.env.STRIPE_PRICE_ID_PRO_PLUS;
    else process.env.STRIPE_PRICE_ID_PRO_PLUS = prevPlus;
    if (prevMax === undefined) delete process.env.STRIPE_PRICE_ID_MAX;
    else process.env.STRIPE_PRICE_ID_MAX = prevMax;
  }

  {
    const billingPatches: Array<Record<string, unknown>> = [];
    let planSet: string | undefined;
    let clearedTiers = false;
    const stripe = {
      isConfigured: () => true,
      verifyWebhookSignature: () => ({
        id: "evt_canceled",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_dead",
            customer: "cus_1",
            status: "canceled",
            items: { data: [{ quantity: 8, price: { id: "price_max" } }] }
          }
        }
      })
    } as unknown as StripeService;
    const prevPro = process.env.STRIPE_PRICE_ID_PRO;
    const prevMax = process.env.STRIPE_PRICE_ID_MAX;
    process.env.STRIPE_PRICE_ID_PRO = "price_pro";
    process.env.STRIPE_PRICE_ID_MAX = "price_max";
    const response = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/webhooks/stripe",
        headers: { "stripe-signature": "t=1,v1=test" },
        body: {},
        rawBody: Buffer.from("{}")
      },
      response,
      {
        serverConfig: { requireApiAuth: false } as ServerConfig,
        stripeService: stripe,
        pool: freshClaimPool(),
        userStore: {
          clearOrgUsersUsageTiers: async () => {
            clearedTiers = true;
            return 3;
          }
        } as never,
        emailService: {} as never,
        orgStore: {
          findOrganizationByStripeCustomerId: async () => ({
            id: "org-1",
            name: "Acme",
            plan: "pro",
            usageTier: "max"
          }),
          setOrganizationPlan: async (_id: string, plan: string) => {
            planSet = plan;
          },
          updateOrganizationBilling: async (_id: string, patch: Record<string, unknown>) => {
            billingPatches.push(patch);
          }
        } as unknown as OrgStore
      }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(planSet, "free");
    assert.equal(clearedTiers, true);
    assert.equal(billingPatches[0]?.usageTier, null);
    assert.equal(billingPatches[0]?.seatCount, 1);
    assert.deepEqual(billingPatches[0]?.seatInventory, { pro: 0, pro_plus: 0, max: 0 });
    assert.equal(billingPatches[0]?.stripeSubscriptionId, undefined);
    if (prevPro === undefined) delete process.env.STRIPE_PRICE_ID_PRO;
    else process.env.STRIPE_PRICE_ID_PRO = prevPro;
    if (prevMax === undefined) delete process.env.STRIPE_PRICE_ID_MAX;
    else process.env.STRIPE_PRICE_ID_MAX = prevMax;
  }

  {
    let collectPayment: boolean | undefined;
    let mutated = false;
    const prevPro = process.env.STRIPE_PRICE_ID_PRO;
    const prevPlus = process.env.STRIPE_PRICE_ID_PRO_PLUS;
    const prevMax = process.env.STRIPE_PRICE_ID_MAX;
    process.env.STRIPE_PRICE_ID_PRO = "price_pro";
    process.env.STRIPE_PRICE_ID_PRO_PLUS = "price_plus";
    process.env.STRIPE_PRICE_ID_MAX = "price_max";
    const res = await seatIncrease(
      baseDeps({
        billing: activeBilling,
        onMutate: () => {
          mutated = true;
        },
        stripe: {
          retrieveSubscription: async () => mockSubscription(2),
          updateSubscriptionItems: async (
            _id: string,
            _items: unknown,
            options?: { collectPayment?: boolean }
          ) => {
            collectPayment = options?.collectPayment;
            return mockSubscription(3);
          },
          createBillingPortalSession: async () => ({ url: "https://billing.stripe.com/session/manage" })
        }
      }),
      { addSeats: 1, tier: "max" }
    );
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body ?? "{}");
    assert.equal(payload.applied, true);
    assert.equal(collectPayment, true);
    assert.equal(mutated, true);
    if (prevPro === undefined) delete process.env.STRIPE_PRICE_ID_PRO;
    else process.env.STRIPE_PRICE_ID_PRO = prevPro;
    if (prevPlus === undefined) delete process.env.STRIPE_PRICE_ID_PRO_PLUS;
    else process.env.STRIPE_PRICE_ID_PRO_PLUS = prevPlus;
    if (prevMax === undefined) delete process.env.STRIPE_PRICE_ID_MAX;
    else process.env.STRIPE_PRICE_ID_MAX = prevMax;
  }

  {
    let mutated = false;
    const prevPro = process.env.STRIPE_PRICE_ID_PRO;
    const prevMax = process.env.STRIPE_PRICE_ID_MAX;
    process.env.STRIPE_PRICE_ID_PRO = "price_pro";
    process.env.STRIPE_PRICE_ID_MAX = "price_max";
    const res = await seatIncrease(
      baseDeps({
        billing: activeBilling,
        onMutate: () => {
          mutated = true;
        },
        stripe: {
          retrieveSubscription: async () => mockSubscription(2),
          updateSubscriptionItems: async () => {
            throw new StripeRequestError("Your card was declined.", 402, "card_declined");
          }
        }
      }),
      { addSeats: 1, tier: "max" }
    );
    assert.equal(res.statusCode, 402);
    assert.match(res.body ?? "", /payment_failed/);
    assert.equal(mutated, false);
    if (prevPro === undefined) delete process.env.STRIPE_PRICE_ID_PRO;
    else process.env.STRIPE_PRICE_ID_PRO = prevPro;
    if (prevMax === undefined) delete process.env.STRIPE_PRICE_ID_MAX;
    else process.env.STRIPE_PRICE_ID_MAX = prevMax;
  }

  {
    let mutated = false;
    const res = await seatIncrease(
      baseDeps({
        billing: activeBilling,
        onMutate: () => {
          mutated = true;
        },
        stripe: {
          retrieveSubscription: async () => ({
            id: "sub_123",
            status: "canceled",
            quantity: 2,
            itemId: "si_123",
            items: [{ id: "si_123", quantity: 2, priceId: "price_pro" }]
          })
        }
      }),
      { addSeats: 1 }
    );
    assert.equal(res.statusCode, 409);
    assert.match(res.body ?? "", /subscription_inactive/);
    assert.equal(mutated, false);
  }

  {
    const store = memoryCheckoutStore();
    const pool = freshClaimPool();
    const event = checkoutCompletedEvent("evt_checkout_once");
    const first = await postStripeWebhook(event, store, pool);
    const second = await postStripeWebhook(event, store, pool);
    assert.equal(first.statusCode, 200);
    assert.equal(JSON.parse(first.body ?? "{}").duplicate, undefined);
    assert.equal(second.statusCode, 200);
    assert.equal(JSON.parse(second.body ?? "{}").duplicate, true);
    assert.equal(store.orgs.length, 1);
    assert.equal(store.users.length, 1);
    assert.equal(store.orgs[0]?.stripeCustomerId, "cus_replay");
  }

  {
    const store = memoryCheckoutStore();
    store.failNextOrgCreates(1);
    const pool = freshClaimPool();
    const event = checkoutCompletedEvent("evt_checkout_retry");
    const failed = await postStripeWebhook(event, store, pool);
    assert.equal(failed.statusCode, 500);
    assert.equal(store.orgs.length, 0);
    const retried = await postStripeWebhook(event, store, pool);
    assert.equal(retried.statusCode, 200);
    assert.equal(JSON.parse(retried.body ?? "{}").duplicate, undefined);
    assert.equal(store.orgs.length, 1);
    assert.equal(store.users.length, 1);
    const third = await postStripeWebhook(event, store, pool);
    assert.equal(third.statusCode, 200);
    assert.equal(JSON.parse(third.body ?? "{}").duplicate, true);
    assert.equal(store.orgs.length, 1);
    assert.equal(store.users.length, 1);
  }

  {
    const store = memoryCheckoutStore();
    const response = await postStripeWebhook(checkoutCompletedEvent("evt_no_pool"), store, undefined);
    assert.equal(response.statusCode, 503);
    assert.match(response.body ?? "", /webhook_dedup_unavailable/);
    assert.equal(store.orgs.length, 0);
    assert.equal(store.createOrgCalls, 0);
  }

  {
    const store = memoryCheckoutStore();
    const pool = freshClaimPool();
    await pool.query(
      `INSERT INTO stripe_webhook_events (event_id, event_type, status) VALUES ($1, $2, 'processing')`,
      ["evt_inflight", "checkout.session.completed"]
    );
    const response = await postStripeWebhook(checkoutCompletedEvent("evt_inflight"), store, pool);
    assert.equal(response.statusCode, 500);
    assert.equal(JSON.parse(response.body ?? "{}").duplicate, undefined);
    assert.match(response.body ?? "", /webhook_in_progress/);
    assert.equal(store.createOrgCalls, 0);
  }

  {
    const store = memoryCheckoutStore();
    const pool = freshClaimPool();
    const event = checkoutCompletedEvent("evt_expanded_customer");
    const session = (event.data as { object: Record<string, unknown> }).object;
    session.customer = { id: "cus_expanded" };
    session.subscription = { id: "sub_expanded" };
    const response = await postStripeWebhook(event, store, pool);
    assert.equal(response.statusCode, 200);
    assert.equal(store.orgs.length, 1);
    assert.equal(store.orgs[0]?.stripeCustomerId, "cus_expanded");
    assert.equal(store.orgs[0]?.stripeSubscriptionId, "sub_expanded");
    assert.notEqual(store.orgs[0]?.stripeCustomerId, "[object Object]");
  }

  {
    const store = memoryCheckoutStore();
    const pool = freshClaimPool();
    const event = checkoutCompletedEvent("evt_missing_customer");
    const session = (event.data as { object: Record<string, unknown> }).object;
    delete session.customer;
    const first = await postStripeWebhook(event, store, pool);
    const second = await postStripeWebhook(event, store, pool);
    assert.equal(first.statusCode, 500);
    assert.equal(JSON.parse(first.body ?? "{}").duplicate, undefined);
    assert.equal(second.statusCode, 500);
    assert.equal(JSON.parse(second.body ?? "{}").duplicate, undefined);
    assert.equal(store.orgs.length, 0);
    assert.equal(store.createOrgCalls, 0);
  }

  {
    const orgs = [
      {
        id: "org-free",
        name: "Acme",
        plan: "free" as "free" | "pro",
        stripeCustomerId: undefined as string | undefined,
        stripeSubscriptionId: undefined as string | undefined,
        billingStatus: "none",
        seatCount: 1,
        usageTier: undefined as string | undefined
      }
    ];
    let upgradeEmails = 0;
    let createOrgCalls = 0;
    const orgStore = {
      findOrganizationByStripeCustomerId: async (customerId: string) =>
        orgs.find((org) => org.stripeCustomerId === customerId),
      getOrganization: async (orgId: string) => orgs.find((org) => org.id === orgId),
      getOrganizationBilling: async (orgId: string) => {
        const org = orgs.find((row) => row.id === orgId);
        if (!org) return undefined;
        return {
          stripeCustomerId: org.stripeCustomerId,
          stripeSubscriptionId: org.stripeSubscriptionId,
          seatCount: org.seatCount,
          billingStatus: org.billingStatus,
          usageTier: org.usageTier
        };
      },
      setOrganizationPlan: async (orgId: string, plan: "free" | "pro") => {
        const org = orgs.find((row) => row.id === orgId);
        if (org) org.plan = plan;
      },
      updateOrganizationBilling: async (orgId: string, patch: Record<string, unknown>) => {
        const org = orgs.find((row) => row.id === orgId);
        if (!org) return;
        if (typeof patch.stripeCustomerId === "string") org.stripeCustomerId = patch.stripeCustomerId;
        if (typeof patch.stripeSubscriptionId === "string") org.stripeSubscriptionId = patch.stripeSubscriptionId;
        if (typeof patch.billingStatus === "string") org.billingStatus = patch.billingStatus;
        if (typeof patch.seatCount === "number") org.seatCount = patch.seatCount;
        if (typeof patch.usageTier === "string") org.usageTier = patch.usageTier;
      },
      createOrganization: async () => {
        createOrgCalls += 1;
        throw new Error("should not create a second org");
      },
      createOrganizationForCheckout: async () => {
        createOrgCalls += 1;
        throw new Error("should not create a second org");
      }
    } as unknown as OrgStore;
    const stripe = {
      isConfigured: () => true,
      retrieveCheckoutSession: async () => ({
        id: "cs_paid_existing",
        payment_status: "paid",
        status: "complete",
        customer: "cus_paid",
        subscription: "sub_paid",
        customer_email: "buyer@example.com",
        metadata: {
          admin_email: "buyer@example.com",
          org_name: "Acme",
          existing_org_id: "org-free",
          upgrade: "true",
          seat_count: "1",
          usage_tier: "pro",
          stripe_price_id: "price_pro"
        }
      })
    } as unknown as StripeService;
    const deps: BillingApiDeps = {
      serverConfig: { requireApiAuth: false } as ServerConfig,
      stripeService: stripe,
      orgStore,
      userStore: {
        findActiveUserByEmail: async () => ({
          id: "user-free",
          orgId: "org-free",
          email: "buyer@example.com"
        }),
        backfillOrgUsersUsageTier: async () => 1
      } as unknown as BillingApiDeps["userStore"],
      emailService: {
        sendProUpgradeWelcome: async () => {
          upgradeEmails += 1;
        },
        sendWelcome: async () => {
          throw new Error("existing workspace should get the upgrade email");
        }
      } as unknown as BillingApiDeps["emailService"]
    };
    const poll = async () => {
      const response = mockResponse();
      await handleBillingApiRequest(
        {
          method: "GET",
          pathname: "/v1/billing/checkout-status",
          query: new URLSearchParams({ session_id: "cs_paid_existing" }),
          headers: {},
          body: {},
          rawBody: Buffer.from("")
        },
        response,
        deps
      );
      return response;
    };
    const first = await poll();
    const second = await poll();
    assert.equal(first.statusCode, 200);
    assert.equal(JSON.parse(first.body ?? "{}").status, "ready");
    assert.equal(second.statusCode, 200);
    assert.equal(JSON.parse(second.body ?? "{}").status, "ready");
    assert.equal(orgs.length, 1);
    assert.equal(orgs[0]?.plan, "pro");
    assert.equal(orgs[0]?.stripeCustomerId, "cus_paid");
    assert.equal(orgs[0]?.stripeSubscriptionId, "sub_paid");
    assert.equal(orgs[0]?.billingStatus, "active");
    assert.equal(orgs[0]?.seatCount, 1);
    assert.equal(orgs[0]?.usageTier, "pro");
    assert.equal(createOrgCalls, 0);
    assert.equal(upgradeEmails, 1);
  }

  {
    const billingPatches: Array<Record<string, unknown>> = [];
    let planSet: string | undefined;
    let updatedOrgId: string | undefined;
    const stripe = {
      isConfigured: () => true,
      verifyWebhookSignature: () => ({
        id: "evt_link_existing",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_linked",
            customer: { id: "cus_linked" },
            status: "active",
            metadata: { existing_org_id: "org-free" },
            items: { data: [{ quantity: 1, price: { id: "price_pro" } }] }
          }
        }
      })
    } as unknown as StripeService;
    const response = mockResponse();
    await handleBillingApiRequest(
      {
        method: "POST",
        pathname: "/webhooks/stripe",
        headers: { "stripe-signature": "t=1,v1=test" },
        body: {},
        rawBody: Buffer.from("{}")
      },
      response,
      {
        serverConfig: { requireApiAuth: false } as ServerConfig,
        stripeService: stripe,
        pool: freshClaimPool(),
        userStore: {} as never,
        emailService: {} as never,
        orgStore: {
          findOrganizationByStripeCustomerId: async () => undefined,
          getOrganization: async (orgId: string) =>
            orgId === "org-free"
              ? { id: "org-free", name: "Acme", plan: "free" as const, createdAt: new Date() }
              : undefined,
          setOrganizationPlan: async (orgId: string, plan: string) => {
            updatedOrgId = orgId;
            planSet = plan;
          },
          updateOrganizationBilling: async (orgId: string, patch: Record<string, unknown>) => {
            updatedOrgId = orgId;
            billingPatches.push(patch);
          }
        } as unknown as OrgStore
      }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(updatedOrgId, "org-free");
    assert.equal(planSet, "pro");
    assert.equal(billingPatches[0]?.stripeCustomerId, "cus_linked");
    assert.equal(billingPatches[0]?.stripeSubscriptionId, "sub_linked");
    assert.equal(billingPatches[0]?.billingStatus, "active");
    assert.notEqual(billingPatches[0]?.stripeCustomerId, "[object Object]");
  }

  console.log("billingApi.test.ts: ok");
})();

function checkoutCompletedEvent(id: string): Record<string, unknown> {
  return {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_replay",
        customer: "cus_replay",
        subscription: "sub_replay",
        customer_email: "buyer@example.com",
        metadata: {
          org_name: "Acme",
          admin_email: "buyer@example.com",
          seat_count: "2"
        }
      }
    }
  };
}

function memoryCheckoutStore(): {
  orgs: Array<{ id: string; name: string; stripeCustomerId?: string; stripeSubscriptionId?: string }>;
  users: Array<{ id: string; orgId: string; email: string }>;
  createOrgCalls: number;
  failNextOrgCreates: (count: number) => void;
  orgStore: OrgStore;
  userStore: BillingApiDeps["userStore"];
  emailService: BillingApiDeps["emailService"];
} {
  const orgs: Array<{ id: string; name: string; stripeCustomerId?: string; stripeSubscriptionId?: string }> = [];
  const users: Array<{ id: string; orgId: string; email: string }> = [];
  let createOrgCalls = 0;
  let failCreates = 0;
  const api = {
    orgs,
    users,
    get createOrgCalls() {
      return createOrgCalls;
    },
    failNextOrgCreates(count: number) {
      failCreates = count;
    },
    orgStore: {
      findOrganizationByStripeCustomerId: async (customerId: string) =>
        orgs.find((org) => org.stripeCustomerId === customerId),
      createOrganization: async (name: string) => {
        createOrgCalls += 1;
        if (failCreates > 0) {
          failCreates -= 1;
          throw new Error("checkout insert failed");
        }
        const org = { id: `org-${orgs.length + 1}`, name };
        orgs.push(org);
        return { ...org, plan: "pro" as const, createdAt: new Date() };
      },
      updateOrganizationBilling: async (
        orgId: string,
        patch: { stripeCustomerId?: string | null; stripeSubscriptionId?: string | null }
      ) => {
        const org = orgs.find((row) => row.id === orgId);
        if (!org) return;
        if (patch.stripeCustomerId) {
          org.stripeCustomerId = patch.stripeCustomerId;
        }
        if (patch.stripeSubscriptionId) {
          org.stripeSubscriptionId = patch.stripeSubscriptionId;
        }
      }
    } as unknown as OrgStore,
    userStore: {
      findActiveUserByEmail: async (email: string) => users.find((user) => user.email === email),
      findOrgUserByEmail: async (orgId: string, email: string) =>
        users.find((user) => user.orgId === orgId && user.email === email),
      createUser: async (orgId: string, email: string) => {
        const user = { id: `user-${users.length + 1}`, orgId, email, role: "admin" as const };
        users.push(user);
        return { ...user, createdAt: new Date() };
      }
    } as BillingApiDeps["userStore"],
    emailService: {
      sendWelcome: async () => undefined
    } as unknown as BillingApiDeps["emailService"]
  };
  return api;
}

async function postStripeWebhook(
  event: Record<string, unknown>,
  store: ReturnType<typeof memoryCheckoutStore>,
  pool: BillingApiDeps["pool"]
): Promise<ServerResponse & { statusCode?: number; body?: string }> {
  const response = mockResponse();
  await handleBillingApiRequest(
    {
      method: "POST",
      pathname: "/webhooks/stripe",
      headers: { "stripe-signature": "t=1,v1=test" },
      body: {},
      rawBody: Buffer.from("{}")
    },
    response,
    {
      serverConfig: { requireApiAuth: false } as ServerConfig,
      stripeService: {
        isConfigured: () => true,
        verifyWebhookSignature: () => event
      } as unknown as StripeService,
      pool,
      orgStore: store.orgStore,
      userStore: store.userStore,
      emailService: store.emailService
    }
  );
  return response;
}
