import type { OrgStore, OrgBilling } from "../orgStore";
import { loadBillingConfig } from "./billingConfig";
import { StripeService } from "./stripeService";

/**
 * Effective purchased seat count for an org. When Stripe quantity is ahead of
 * Coop (webhook lag), heals Coop upward and returns the Stripe value.
 */
export async function resolveEffectiveSeatCount(
  orgStore: OrgStore,
  orgId: string,
  billing: OrgBilling | undefined | null
): Promise<number> {
  let seats = Math.max(1, Math.floor(Number(billing?.seatCount ?? 1) || 1));
  if (!billing?.stripeSubscriptionId) {
    return seats;
  }

  const stripe = new StripeService(loadBillingConfig());
  if (!stripe.isConfigured()) {
    return seats;
  }

  try {
    const subscription = await stripe.retrieveSubscription(billing.stripeSubscriptionId);
    if (subscription.quantity == null) {
      return seats;
    }
    const stripeSeats = Math.max(1, Math.floor(Number(subscription.quantity) || 1));
    if (stripeSeats > seats) {
      await orgStore.updateOrganizationBilling(orgId, { seatCount: stripeSeats });
      return stripeSeats;
    }
  } catch {
    // Leave Coop seats if Stripe is temporarily unavailable.
  }

  return seats;
}
