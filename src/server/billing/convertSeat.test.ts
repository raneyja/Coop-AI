import assert from "node:assert/strict";
import {
  convertSeatInPlace,
  neverFilledSeats,
  stripeItemUpdatesForInventory
} from "./seatInventory";
import {
  BILLING_UNAVAILABLE_MESSAGE,
  convertMemberUsageTier,
  isStripeModeMismatch,
  isStripePaymentFailure,
  mapStripeConvertError,
  NO_STRIPE_SUBSCRIPTION_MESSAGE,
  PAYMENT_FAILED_MESSAGE,
  SeatConvertError,
  STRIPE_MODE_MISMATCH_MESSAGE,
  subscriptionInactiveMessage
} from "./convertSeat";
import type { BillingConfig } from "./billingConfig";
import type { OrgStore } from "../orgStore";
import type { UserStore } from "../users/userStore";
import {
  collectedInvoiceIsSettled,
  isLatestInvoiceSettled,
  StripeRequestError,
  subscriptionAllowsPaidMutation,
  type StripeService,
  type StripeSubscription
} from "./stripeService";

const prices = { pro: "price_pro", proPlus: "price_plus", max: "price_max" };

// Alice Pro → Max must not consume a spare empty Max.
const purchased = { pro: 8, pro_plus: 0, max: 2 };
const occupied = { pro: 8, pro_plus: 0, max: 1 };
const next = convertSeatInPlace(purchased, "pro", "max");
assert.deepEqual(next, { pro: 7, pro_plus: 0, max: 3 });
const occupiedAfter = { pro: 7, pro_plus: 0, max: 2 };
assert.deepEqual(neverFilledSeats(next, occupiedAfter), { pro: 0, pro_plus: 0, max: 1 });

const updates = stripeItemUpdatesForInventory(
  [
    { id: "si_pro", quantity: 8, priceId: "price_pro" },
    { id: "si_max", quantity: 2, priceId: "price_max" }
  ],
  next,
  prices
);
assert.deepEqual(updates, [
  { id: "si_pro", quantity: 7 },
  { id: "si_max", quantity: 3 }
]);

assert.equal(
  isStripeModeMismatch(
    "No such subscription: 'sub_1PqllA2eRbu2Kw7Okdmc0hUX'; a similar object exists in test mode, but a live mode key was used to make this request."
  ),
  true
);
assert.equal(isStripeModeMismatch("No such subscription: sub_missing"), false);

const mapped = mapStripeConvertError(
  new Error(
    "No such subscription: 'sub_test'; a similar object exists in test mode, but a live mode key was used to make this request."
  )
);
assert.equal(mapped.code, "stripe_mode_mismatch");
assert.equal(mapped.statusCode, 409);
assert.equal(mapped.message, STRIPE_MODE_MISMATCH_MESSAGE);
assert.equal(mapped.message.includes("similar object exists"), false);

const passthrough = mapStripeConvertError(new SeatConvertError("inventory_conflict", "nope", 409));
assert.equal(passthrough.code, "inventory_conflict");

const declined = mapStripeConvertError(new StripeRequestError("Your card was declined.", 402, "card_declined"));
assert.equal(declined.code, "payment_failed");
assert.equal(declined.statusCode, 402);
assert.equal(declined.message, PAYMENT_FAILED_MESSAGE);
assert.equal(isStripePaymentFailure(new StripeRequestError("incomplete", 402, "payment_incomplete")), true);
assert.equal(isLatestInvoiceSettled({ paid: true, status: "paid" }), true);
assert.equal(isLatestInvoiceSettled({ paid: false, status: "open", amountDue: 3500 }), false);
assert.equal(isLatestInvoiceSettled({ paid: false, status: "open", amountDue: 0 }), true);
assert.equal(collectedInvoiceIsSettled({ paid: true, status: "paid" }), true);
assert.equal(collectedInvoiceIsSettled({ paid: false, status: "open", amountDue: 3500 }), false);
assert.equal(collectedInvoiceIsSettled(undefined), false);
assert.equal(collectedInvoiceIsSettled("in_unexpanded"), false);
assert.equal(subscriptionAllowsPaidMutation({ status: "active" }), true);
assert.equal(subscriptionAllowsPaidMutation({ status: "trialing" }), true);
assert.equal(subscriptionAllowsPaidMutation({ status: "canceled" }), false);
assert.equal(subscriptionAllowsPaidMutation({ status: "active", paused: true }), false);
assert.equal(subscriptionAllowsPaidMutation({ status: "past_due" }), false);
assert.equal(subscriptionAllowsPaidMutation({ status: "unpaid" }), false);
assert.match(subscriptionInactiveMessage({ status: "canceled" }), /canceled/);

const billingConfig = {
  stripeSecretKey: "sk_test",
  stripePriceIdPro: "price_pro",
  stripePriceIdProPlus: "price_plus",
  stripePriceIdMax: "price_max",
  checkoutSuccessUrl: "https://example.com/ok",
  checkoutCancelUrl: "https://example.com/cancel",
  adminPortalUrl: "https://admin.example.com",
  billingPortalReturnUrl: "https://admin.example.com/billing",
  emailFrom: "CoopAI <hello@coop-ai.dev>",
  emailMock: true
} as BillingConfig;

function mockSubscription(): StripeSubscription {
  return {
    id: "sub_1",
    status: "active",
    quantity: 2,
    itemId: "si_pro",
    priceId: "price_pro",
    items: [{ id: "si_pro", quantity: 2, priceId: "price_pro" }]
  };
}

function convertDeps(overrides: {
  stripeConfigured?: boolean;
  subscriptionId?: string | null;
  subscription?: StripeSubscription;
  retrieveError?: Error;
  updateError?: Error;
  onRetrieve?: () => void;
  onUpdate?: (collectPayment?: boolean) => void;
  onSetTier?: () => void;
  onBilling?: () => void;
  missingPlusPrice?: boolean;
  fromTier?: "pro" | "pro_plus" | "max";
  toTier?: "pro" | "pro_plus" | "max";
}) {
  let usageTier: "pro" | "pro_plus" | "max" = overrides.fromTier ?? "pro";
  const stripe = {
    isConfigured: () => overrides.stripeConfigured !== false,
    retrieveSubscription: async () => {
      overrides.onRetrieve?.();
      if (overrides.retrieveError) {
        throw overrides.retrieveError;
      }
      return overrides.subscription ?? mockSubscription();
    },
    updateSubscriptionItems: async (
      _id: string,
      _items: unknown,
      options?: { collectPayment?: boolean }
    ) => {
      overrides.onUpdate?.(options?.collectPayment);
      if (overrides.updateError) {
        throw overrides.updateError;
      }
      return overrides.subscription ?? mockSubscription();
    }
  } as unknown as StripeService;

  const config = overrides.missingPlusPrice
    ? ({ ...billingConfig, stripePriceIdProPlus: undefined } as BillingConfig)
    : billingConfig;

  return {
    orgId: "org-1",
    userId: "user-1",
    toTier: overrides.toTier ?? "pro_plus",
    billingConfig: config,
    stripe,
    orgStore: {
      getOrganization: async () => ({ id: "org-1", name: "Acme", plan: "pro", usageTier: "pro" }),
      getOrganizationBilling: async () => ({
        seatCount: 2,
        usageTier: "pro",
        stripeSubscriptionId: overrides.subscriptionId === undefined ? "sub_1" : overrides.subscriptionId,
        seatInventory: { pro: 2, pro_plus: 0, max: 0 }
      }),
      updateOrganizationBilling: async () => {
        overrides.onBilling?.();
      }
    } as unknown as OrgStore,
    userStore: {
      getUser: async () => ({
        id: "user-1",
        orgId: "org-1",
        email: "admin@example.com",
        role: "admin",
        createdAt: new Date(),
        usageTier
      }),
      countOccupiedSeatsByTier: async () => ({ pro: 1, pro_plus: 0, max: 0 }),
      setUserUsageTier: async (_id: string, nextTier: "pro" | "pro_plus" | "max") => {
        overrides.onSetTier?.();
        usageTier = nextTier;
        return {
          id: "user-1",
          orgId: "org-1",
          email: "admin@example.com",
          role: "admin",
          createdAt: new Date(),
          usageTier
        };
      }
    } as unknown as UserStore
  };
}

async function expectConvertError(run: () => Promise<unknown>, code: string): Promise<SeatConvertError> {
  try {
    await run();
  } catch (error) {
    assert.equal(error instanceof SeatConvertError, true);
    const mapped = error as SeatConvertError;
    assert.equal(mapped.code, code);
    return mapped;
  }
  assert.fail(`expected ${code}`);
}

void (async () => {
  {
    let collectPayment: boolean | undefined;
    let setTier = false;
    const result = await convertMemberUsageTier(
      convertDeps({
        onUpdate: (paid) => {
          collectPayment = paid;
        },
        onSetTier: () => {
          setTier = true;
        }
      })
    );
    assert.equal(result.from, "pro");
    assert.equal(result.to, "pro_plus");
    assert.deepEqual(result.inventory, { pro: 1, pro_plus: 1, max: 0 });
    assert.equal(collectPayment, true);
    assert.equal(setTier, true);
  }

  {
    let setTier = false;
    let billed = false;
    const err = await expectConvertError(
      () =>
        convertMemberUsageTier(
          convertDeps({
            stripeConfigured: false,
            onSetTier: () => {
              setTier = true;
            },
            onBilling: () => {
              billed = true;
            }
          })
        ),
      "billing_unavailable"
    );
    assert.equal(err.message, BILLING_UNAVAILABLE_MESSAGE);
    assert.equal(setTier, false);
    assert.equal(billed, false);
  }

  {
    let setTier = false;
    const err = await expectConvertError(
      () =>
        convertMemberUsageTier(
          convertDeps({
            subscriptionId: null,
            onSetTier: () => {
              setTier = true;
            }
          })
        ),
      "no_stripe_subscription"
    );
    assert.equal(err.message, NO_STRIPE_SUBSCRIPTION_MESSAGE);
    assert.equal(setTier, false);
  }

  {
    let setTier = false;
    const err = await expectConvertError(
      () =>
        convertMemberUsageTier(
          convertDeps({
            updateError: new StripeRequestError("Your card was declined.", 402, "card_declined"),
            onSetTier: () => {
              setTier = true;
            }
          })
        ),
      "payment_failed"
    );
    assert.equal(err.statusCode, 402);
    assert.equal(err.message, PAYMENT_FAILED_MESSAGE);
    assert.equal(setTier, false);
  }

  {
    let setTier = false;
    await expectConvertError(
      () =>
        convertMemberUsageTier(
          convertDeps({
            missingPlusPrice: true,
            onSetTier: () => {
              setTier = true;
            }
          })
        ),
      "tier_not_configured"
    );
    assert.equal(setTier, false);
  }

  {
    let setTier = false;
    await expectConvertError(
      () =>
        convertMemberUsageTier(
          convertDeps({
            subscription: {
              id: "sub_1",
              status: "active",
              items: []
            },
            onSetTier: () => {
              setTier = true;
            }
          })
        ),
      "stripe_item_missing"
    );
    assert.equal(setTier, false);
  }

  {
    let retrieved = false;
    const result = await convertMemberUsageTier(
      convertDeps({
        fromTier: "pro",
        toTier: "pro",
        onRetrieve: () => {
          retrieved = true;
        }
      })
    );
    assert.equal(result.from, "pro");
    assert.equal(result.to, "pro");
    assert.equal(retrieved, false);
  }

  {
    let setTier = false;
    let billed = false;
    let updated = false;
    const err = await expectConvertError(
      () =>
        convertMemberUsageTier(
          convertDeps({
            subscription: {
              id: "sub_1",
              status: "canceled",
              items: [{ id: "si_pro", quantity: 2, priceId: "price_pro" }]
            },
            onUpdate: () => {
              updated = true;
            },
            onSetTier: () => {
              setTier = true;
            },
            onBilling: () => {
              billed = true;
            }
          })
        ),
      "subscription_inactive"
    );
    assert.match(err.message, /canceled/);
    assert.equal(setTier, false);
    assert.equal(billed, false);
    assert.equal(updated, false);
  }

  {
    let setTier = false;
    await expectConvertError(
      () =>
        convertMemberUsageTier(
          convertDeps({
            subscription: {
              id: "sub_1",
              status: "past_due",
              items: [{ id: "si_pro", quantity: 2, priceId: "price_pro" }]
            },
            onSetTier: () => {
              setTier = true;
            }
          })
        ),
      "subscription_inactive"
    );
    assert.equal(setTier, false);
  }

  {
    let setTier = false;
    await expectConvertError(
      () =>
        convertMemberUsageTier(
          convertDeps({
            subscription: {
              id: "sub_1",
              status: "active",
              paused: true,
              items: [{ id: "si_pro", quantity: 2, priceId: "price_pro" }]
            },
            onSetTier: () => {
              setTier = true;
            }
          })
        ),
      "subscription_inactive"
    );
    assert.equal(setTier, false);
  }

  {
    let setTier = false;
    await expectConvertError(
      () =>
        convertMemberUsageTier(
          convertDeps({
            subscription: {
              id: "sub_1",
              status: "unpaid",
              items: [{ id: "si_pro", quantity: 2, priceId: "price_pro" }]
            },
            onSetTier: () => {
              setTier = true;
            }
          })
        ),
      "subscription_inactive"
    );
    assert.equal(setTier, false);
  }

  console.log("convertSeat: 1/1 tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
