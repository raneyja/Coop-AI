import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { handleBillingApiRequest, type BillingApiDeps } from "./billingApi";
import type { AuthContext, OrgStore } from "../orgStore";
import type { ServerConfig } from "../serverConfig";
import type { StripeService } from "./stripeService";

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

  console.log("billingApi.test.ts: ok");
})();
