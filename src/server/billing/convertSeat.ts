import type { OrgStore } from "../orgStore";
import type { UserStore } from "../users/userStore";
import type { UsageTier } from "../usageTiers";
import { displayUsageTierName, parseUsageTier, stripePriceIdForUsageTier } from "../usageTiers";
import type { BillingConfig } from "./billingConfig";
import {
  convertSeatInPlace,
  neverFilledSeats,
  parseStripeItemsToInventory,
  seatInventoryTotal,
  stripeItemUpdatesForInventory,
  type SeatInventory
} from "./seatInventory";
import {
  StripeRequestError,
  subscriptionAllowsPaidMutation,
  type StripeService,
  type StripeSubscription
} from "./stripeService";

export class SeatConvertError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  public constructor(code: string, message: string, statusCode = 409) {
    super(message);
    this.name = "SeatConvertError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const STRIPE_MODE_MISMATCH_MESSAGE =
  "This organization's billing doesn't match production Stripe. The seat was not changed. Contact Coop support.";

export const PAYMENT_FAILED_MESSAGE =
  "The card on file was declined or could not be charged. Update the payment method in Billing, then try again. The seat was not changed.";

export const NO_STRIPE_SUBSCRIPTION_MESSAGE =
  "This organization has no Stripe subscription. The seat was not changed. Contact Coop support.";

export const BILLING_UNAVAILABLE_MESSAGE =
  "Billing is not available. The seat was not changed.";

export const STRIPE_ITEM_MISSING_MESSAGE =
  "Could not find this subscription in Stripe. The seat was not changed.";

export const SUBSCRIPTION_INACTIVE_MESSAGE =
  "This organization's Stripe subscription is not active. Update billing, then try again. The seat was not changed.";

export function subscriptionInactiveMessage(subscription: {
  status?: string | null;
  paused?: boolean;
}): string {
  const status = String(subscription.status ?? "").toLowerCase();
  if (subscription.paused || status === "paused") {
    return "This organization's billing is paused. The seat was not changed.";
  }
  if (status === "past_due" || status === "incomplete") {
    return "This organization's payment is past due. Update the card in Billing, then try again. The seat was not changed.";
  }
  if (
    status === "canceled" ||
    status === "cancelled" ||
    status === "unpaid" ||
    status === "incomplete_expired"
  ) {
    return "This organization's Stripe subscription is canceled. The seat was not changed.";
  }
  return SUBSCRIPTION_INACTIVE_MESSAGE;
}

export function isStripeModeMismatch(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("similar object exists") &&
    (lower.includes("test mode") || lower.includes("live mode"))
  );
}

export function isStripePaymentFailure(error: unknown): boolean {
  if (error instanceof StripeRequestError) {
    if (error.statusCode === 402 || error.stripeCode === "payment_incomplete") {
      return true;
    }
    if (error.stripeCode && PAYMENT_FAILURE_CODES.has(error.stripeCode)) {
      return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /card declined|insufficient funds|expired card|requires.?action|payment.?intent|could not be charged/i.test(
    message
  );
}

const PAYMENT_FAILURE_CODES = new Set([
  "card_declined",
  "expired_card",
  "insufficient_funds",
  "payment_intent_authentication_failure",
  "invoice_payment_intent_requires_action",
  "subscription_payment_intent_requires_action",
  "payment_incomplete"
]);

export function mapStripeConvertError(error: unknown): SeatConvertError {
  if (error instanceof SeatConvertError) {
    return error;
  }
  const message = error instanceof Error ? error.message : "";
  if (isStripeModeMismatch(message)) {
    return new SeatConvertError("stripe_mode_mismatch", STRIPE_MODE_MISMATCH_MESSAGE, 409);
  }
  if (isStripePaymentFailure(error)) {
    return new SeatConvertError("payment_failed", PAYMENT_FAILED_MESSAGE, 402);
  }
  if (/missing_price_/i.test(message)) {
    return new SeatConvertError(
      "tier_not_configured",
      "This plan is not configured for billing. The seat was not changed. Contact Coop support.",
      503
    );
  }
  return new SeatConvertError(
    "convert_failed",
    message.trim() || "Could not update this seat in Stripe. The seat was not changed.",
    502
  );
}

export type ConvertMemberResult = {
  from: UsageTier;
  to: UsageTier;
  inventory: SeatInventory;
};

export async function convertMemberUsageTier(input: {
  orgId: string;
  userId: string;
  toTier: UsageTier;
  orgStore: OrgStore;
  userStore: UserStore;
  stripe: StripeService;
  billingConfig: BillingConfig;
}): Promise<ConvertMemberResult> {
  const user = await input.userStore.getUser(input.userId);
  if (!user || user.orgId !== input.orgId) {
    throw new SeatConvertError("user_not_found", "User not found.", 404);
  }

  const org = await input.orgStore.getOrganization(input.orgId);
  const billing = await input.orgStore.getOrganizationBilling(input.orgId);
  const from =
    parseUsageTier(user.usageTier) ?? parseUsageTier(org?.usageTier) ?? parseUsageTier(billing?.usageTier) ?? "pro";
  const to = input.toTier;
  if (from === to) {
    return { from, to, inventory: billing?.seatInventory ?? { pro: 0, pro_plus: 0, max: 0 } };
  }

  if (!input.stripe.isConfigured()) {
    throw new SeatConvertError("billing_unavailable", BILLING_UNAVAILABLE_MESSAGE, 503);
  }
  if (!billing?.stripeSubscriptionId) {
    throw new SeatConvertError("no_stripe_subscription", NO_STRIPE_SUBSCRIPTION_MESSAGE, 409);
  }

  const prices = {
    pro: input.billingConfig.stripePriceIdPro,
    proPlus: input.billingConfig.stripePriceIdProPlus,
    max: input.billingConfig.stripePriceIdMax
  };
  if (!stripePriceIdForUsageTier(to, prices)) {
    throw new SeatConvertError(
      "tier_not_configured",
      `${displayUsageTierName(to)} is not configured for billing. The seat was not changed. Contact Coop support.`,
      503
    );
  }

  let subscription: StripeSubscription;
  try {
    subscription = await input.stripe.retrieveSubscription(billing.stripeSubscriptionId);
  } catch (error) {
    throw mapStripeConvertError(error);
  }
  if (!subscriptionAllowsPaidMutation(subscription)) {
    throw new SeatConvertError("subscription_inactive", subscriptionInactiveMessage(subscription), 409);
  }

  const stripeItems: Array<{ id?: string; quantity?: number; priceId?: string }> =
    subscription.items?.length > 0
      ? subscription.items
      : subscription.itemId
        ? [
            {
              id: subscription.itemId,
              quantity: subscription.quantity,
              priceId: subscription.priceId
            }
          ]
        : [];
  if (stripeItems.length === 0) {
    throw new SeatConvertError("stripe_item_missing", STRIPE_ITEM_MISSING_MESSAGE, 502);
  }

  const purchased = parseStripeItemsToInventory(stripeItems, prices);
  let nextPurchased: SeatInventory;
  try {
    nextPurchased = convertSeatInPlace(purchased, from, to);
  } catch {
    throw new SeatConvertError(
      "convert_source_empty",
      `No ${from} seat is purchased to convert in place.`
    );
  }

  const occupied = await input.userStore.countOccupiedSeatsByTier(input.orgId);
  const occupiedAfter = { ...occupied };
  occupiedAfter[from] = Math.max(0, occupiedAfter[from] - 1);
  occupiedAfter[to] += 1;
  const leftover = neverFilledSeats(nextPurchased, occupiedAfter);
  if (nextPurchased[from] < occupiedAfter[from] || nextPurchased[to] < occupiedAfter[to]) {
    throw new SeatConvertError(
      "inventory_conflict",
      "This convert no longer fits the purchased seats. Refresh and try again."
    );
  }
  void leftover;

  try {
    const updates = stripeItemUpdatesForInventory(stripeItems, nextPurchased, prices);
    await input.stripe.updateSubscriptionItems(billing.stripeSubscriptionId, updates, {
      collectPayment: true
    });
  } catch (error) {
    throw mapStripeConvertError(error);
  }

  const updated = await input.userStore.setUserUsageTier(input.userId, to);
  if (!updated) {
    throw new SeatConvertError("user_not_found", "User not found.", 404);
  }

  await input.orgStore.updateOrganizationBilling(input.orgId, {
    seatCount: Math.max(1, seatInventoryTotal(nextPurchased)),
    seatInventory: nextPurchased
  });

  return { from, to, inventory: nextPurchased };
}
