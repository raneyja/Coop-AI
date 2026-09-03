import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleBillingApiRequest, usageTierForStripePrice, type BillingApiDeps } from "./billingApi";
import type { AuthContext, OrgStore } from "../orgStore";
import type { ServerConfig } from "../serverConfig";
import type { StripeService } from "./stripeService";
import type { BillingConfig } from "./billingConfig";

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
    retrieveSubscription: async () => ({ id: "sub_123", status: "active", quantity: 2, itemId: "si_123" }),
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
  body: { seats?: unknown; addSeats?: unknown }
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
          retrieveSubscription: async () => ({
            id: "sub_123",
            status: "active",
            quantity: 3,
            itemId: "si_123"
          }),
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
          retrieveSubscription: async () => ({
            id: "sub_123",
            status: "active",
            quantity: 5,
            itemId: "si_123"
          }),
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
          retrieveSubscription: async () => ({
            id: "sub_123",
            status: "active",
            quantity: 5,
            itemId: "si_123"
          })
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
          retrieveSubscription: async () => ({
            id: "sub_123",
            status: "active",
            quantity: 5,
            itemId: "si_123"
          }),
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
    let checkout: { priceId?: string; usageTier?: string } | undefined;
    const stripe = {
      isConfigured: () => true,
      createCheckoutSession: async (input: { priceId?: string; usageTier?: string }) => {
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
    if (prevPro === undefined) delete process.env.STRIPE_PRICE_ID_PRO;
    else process.env.STRIPE_PRICE_ID_PRO = prevPro;
    if (prevPlus === undefined) delete process.env.STRIPE_PRICE_ID_PRO_PLUS;
    else process.env.STRIPE_PRICE_ID_PRO_PLUS = prevPlus;
  }

  console.log("billingApi.test.ts: ok");
})();
