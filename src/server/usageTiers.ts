/** Paid usage bucket. Capability plan stays `free | pro | enterprise`. */
export type UsageTier = "pro" | "pro_plus" | "max";
export type CapabilityPlan = "free" | "pro" | "enterprise";

export type UsageTierLimits = {
  seatPriceUsd: number;
  autoCents: number;
  frontierCents: number;
};

export const USAGE_TIER_LIMITS: Record<UsageTier, UsageTierLimits> = {
  pro: { seatPriceUsd: 25, autoCents: 4000, frontierCents: 2500 },
  pro_plus: { seatPriceUsd: 60, autoCents: 12000, frontierCents: 7000 },
  max: { seatPriceUsd: 100, autoCents: 24000, frontierCents: 14000 }
};

const USAGE_TIER_SET = new Set<UsageTier>(["pro", "pro_plus", "max"]);

export function parseUsageTier(value: string | null | undefined): UsageTier | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "pro" || normalized === "pro_plus" || normalized === "max") {
    return normalized;
  }
  return null;
}

/**
 * Paid orgs with a missing column still cap at Pro (fail closed).
 * Enterprise and free do not use monthly cents.
 */
export function effectiveUsageTier(
  plan: CapabilityPlan,
  usageTier?: UsageTier | string | null
): UsageTier | null {
  if (plan === "enterprise" || plan === "free") {
    return null;
  }
  return parseUsageTier(usageTier) ?? (plan === "pro" ? "pro" : null);
}

export function nextUsageTier(tier: UsageTier): UsageTier | "enterprise" {
  if (tier === "pro") {
    return "pro_plus";
  }
  if (tier === "pro_plus") {
    return "max";
  }
  return "enterprise";
}

export function displayPlanName(
  plan: CapabilityPlan | UsageTier | "pro_plus" | "max"
): string {
  if (plan === "pro_plus") {
    return "Pro+";
  }
  if (plan === "max") {
    return "Max";
  }
  if (plan === "enterprise") {
    return "Enterprise";
  }
  if (plan === "pro") {
    return "Pro";
  }
  return "Free";
}

export function displayUsageTierName(tier: UsageTier): string {
  return displayPlanName(tier);
}

/** UTC calendar month — v1 paid period (no Stripe retrieve on the chat hot path). */
export function utcCalendarMonthRange(now = new Date()): { from: Date; to: Date } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

export type StripeUsagePriceIds = {
  pro?: string;
  proPlus?: string;
  max?: string;
};

/** Unknown / legacy prices map to Pro so existing subscriptions stay billed. */
export function usageTierFromStripePriceId(
  priceId: string | undefined | null,
  prices: StripeUsagePriceIds
): UsageTier {
  const id = priceId?.trim();
  if (!id) {
    return "pro";
  }
  if (prices.proPlus && id === prices.proPlus) {
    return "pro_plus";
  }
  if (prices.max && id === prices.max) {
    return "max";
  }
  return "pro";
}

export function stripePriceIdForUsageTier(
  tier: UsageTier,
  prices: StripeUsagePriceIds
): string | undefined {
  if (tier === "pro_plus") {
    return prices.proPlus;
  }
  if (tier === "max") {
    return prices.max;
  }
  return prices.pro;
}
