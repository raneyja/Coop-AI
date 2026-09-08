import {
  parseUsageTier,
  type StripeUsagePriceIds,
  type UsageTier,
  usageTierFromStripePriceId
} from "../usageTiers";

export type SeatInventory = {
  pro: number;
  pro_plus: number;
  max: number;
};

export type StripeInventoryItem = {
  id?: string;
  quantity?: number;
  priceId?: string;
};

export function emptySeatInventory(): SeatInventory {
  return { pro: 0, pro_plus: 0, max: 0 };
}

export function seatInventoryTotal(inventory: SeatInventory): number {
  return inventory.pro + inventory.pro_plus + inventory.max;
}

export function isMixedSeatInventory(inventory: SeatInventory): boolean {
  const buckets = [inventory.pro, inventory.pro_plus, inventory.max].filter((count) => count > 0);
  return buckets.length > 1;
}

export function cloneSeatInventory(inventory: SeatInventory): SeatInventory {
  return { pro: inventory.pro, pro_plus: inventory.pro_plus, max: inventory.max };
}

export function neverFilledSeats(purchased: SeatInventory, occupied: SeatInventory): SeatInventory {
  return {
    pro: Math.max(0, purchased.pro - occupied.pro),
    pro_plus: Math.max(0, purchased.pro_plus - occupied.pro_plus),
    max: Math.max(0, purchased.max - occupied.max)
  };
}

/** Convert Alice's SKU in place. Does not consume a spare empty of `to`. */
export function convertSeatInPlace(
  purchased: SeatInventory,
  from: UsageTier,
  to: UsageTier
): SeatInventory {
  if (from === to) {
    return cloneSeatInventory(purchased);
  }
  if (purchased[from] < 1) {
    throw new Error("convert_source_empty");
  }
  const next = cloneSeatInventory(purchased);
  next[from] -= 1;
  next[to] += 1;
  return next;
}

export function displaySeatMix(inventory: SeatInventory): string {
  const parts: string[] = [];
  if (inventory.pro > 0) {
    parts.push(`${inventory.pro} Pro`);
  }
  if (inventory.pro_plus > 0) {
    parts.push(`${inventory.pro_plus} Pro+`);
  }
  if (inventory.max > 0) {
    parts.push(`${inventory.max} Max`);
  }
  if (parts.length === 0) {
    return "No paid seats";
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return `Mixed (${parts.join(" · ")})`;
}

export function homogeneousUsageTier(inventory: SeatInventory): UsageTier | null {
  if (isMixedSeatInventory(inventory)) {
    return null;
  }
  if (inventory.max > 0) {
    return "max";
  }
  if (inventory.pro_plus > 0) {
    return "pro_plus";
  }
  if (inventory.pro > 0) {
    return "pro";
  }
  return null;
}

export function inventoryFromOrgColumns(row: {
  seatInventoryPro?: number | null;
  seatInventoryProPlus?: number | null;
  seatInventoryMax?: number | null;
  seatCount?: number | null;
  usageTier?: UsageTier | string | null;
}): SeatInventory {
  const stored = {
    pro: Math.max(0, Math.floor(Number(row.seatInventoryPro ?? 0) || 0)),
    pro_plus: Math.max(0, Math.floor(Number(row.seatInventoryProPlus ?? 0) || 0)),
    max: Math.max(0, Math.floor(Number(row.seatInventoryMax ?? 0) || 0))
  };
  if (seatInventoryTotal(stored) > 0) {
    return stored;
  }
  const seats = Math.max(0, Math.floor(Number(row.seatCount ?? 0) || 0));
  const tier = parseUsageTier(row.usageTier) ?? "pro";
  const fallback = emptySeatInventory();
  if (seats > 0) {
    fallback[tier] = seats;
  }
  return fallback;
}

export function parseStripeItemsToInventory(
  items: StripeInventoryItem[],
  prices: StripeUsagePriceIds
): SeatInventory {
  const inventory = emptySeatInventory();
  for (const item of items) {
    const quantity = Math.max(0, Math.floor(Number(item.quantity ?? 0) || 0));
    if (quantity <= 0) {
      continue;
    }
    const tier = usageTierFromStripePriceId(item.priceId, prices);
    inventory[tier] += quantity;
  }
  return inventory;
}

export function addSeatsToInventory(
  purchased: SeatInventory,
  tier: UsageTier,
  addCount: number
): SeatInventory {
  const add = Math.max(0, Math.floor(addCount));
  const next = cloneSeatInventory(purchased);
  next[tier] += add;
  return next;
}

export type SubscriptionItemUpdate = {
  id?: string;
  priceId?: string;
  quantity?: number;
  deleted?: boolean;
};

/**
 * Map a target inventory onto existing Stripe items. Creates a new item when a
 * tier appears; deletes an item when its quantity hits 0. Never replaces the
 * first item's price (that would upgrade every seat).
 */
export function stripeItemUpdatesForInventory(
  currentItems: StripeInventoryItem[],
  target: SeatInventory,
  prices: StripeUsagePriceIds
): SubscriptionItemUpdate[] {
  const used = new Set<string>();
  const updates: SubscriptionItemUpdate[] = [];

  const findItem = (tier: UsageTier): StripeInventoryItem | undefined =>
    currentItems.find((item) => {
      const id = item.id ?? `${item.priceId ?? ""}`;
      if (!item.id && !item.priceId) {
        return false;
      }
      if (used.has(id)) {
        return false;
      }
      return usageTierFromStripePriceId(item.priceId, prices) === tier;
    });

  for (const tier of ["pro", "pro_plus", "max"] as const) {
    const quantity = target[tier];
    const existing = findItem(tier);
    if (existing?.id) {
      used.add(existing.id);
      if (quantity <= 0) {
        updates.push({ id: existing.id, deleted: true });
      } else {
        updates.push({ id: existing.id, quantity });
      }
      continue;
    }
    if (quantity <= 0) {
      continue;
    }
    const priceId =
      tier === "pro_plus" ? prices.proPlus : tier === "max" ? prices.max : prices.pro;
    if (!priceId) {
      throw new Error(`missing_price_${tier}`);
    }
    updates.push({ priceId, quantity });
  }

  for (const item of currentItems) {
    if (item.id && !used.has(item.id)) {
      updates.push({ id: item.id, deleted: true });
    }
  }

  const remaining = updates.filter((item) => !item.deleted);
  if (remaining.length === 0) {
    throw new Error("convert_would_remove_all_items");
  }
  return updates;
}
