import type { OrgStore } from "../orgStore";
import type { UserStore } from "../users/userStore";
import type { UsageTier } from "../usageTiers";
import { parseUsageTier } from "../usageTiers";
import type { BillingConfig } from "./billingConfig";
import {
  convertSeatInPlace,
  neverFilledSeats,
  parseStripeItemsToInventory,
  seatInventoryTotal,
  stripeItemUpdatesForInventory,
  type SeatInventory
} from "./seatInventory";
import type { StripeService } from "./stripeService";

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

  let purchased: SeatInventory = billing?.seatInventory ?? {
    pro: 0,
    pro_plus: 0,
    max: 0
  };
  let stripeItems: Array<{ id?: string; quantity?: number; priceId?: string }> = [];
  const prices = {
    pro: input.billingConfig.stripePriceIdPro,
    proPlus: input.billingConfig.stripePriceIdProPlus,
    max: input.billingConfig.stripePriceIdMax
  };

  if (billing?.stripeSubscriptionId && input.stripe.isConfigured()) {
    const subscription = await input.stripe.retrieveSubscription(billing.stripeSubscriptionId);
    stripeItems =
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
    if (stripeItems.length > 0) {
      purchased = parseStripeItemsToInventory(stripeItems, prices);
    }
  }

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

  if (billing?.stripeSubscriptionId && input.stripe.isConfigured() && stripeItems.length > 0) {
    const updates = stripeItemUpdatesForInventory(stripeItems, nextPurchased, prices);
    await input.stripe.updateSubscriptionItems(billing.stripeSubscriptionId, updates);
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
