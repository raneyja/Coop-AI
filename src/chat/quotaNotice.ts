import { formatTimeInTimezone, resolveTimezone } from "./timezone";

export type QuotaExceededNoticeInput = {
  resetsAt: string;
  upgradeUrl: string;
  timezone?: string;
};

export const PAID_USAGE_EXHAUSTED_COPY = "You've used this month's included usage.";
export function formatQuotaRetryClock(
  resetsAt: string,
  timezone?: string,
  referenceDate = new Date()
): string {
  const formatted = formatTimeInTimezone(resetsAt, resolveTimezone(timezone), {
    hour: "numeric",
    minute: "2-digit"
  });
  return formatted ?? "later";
}

export function buildQuotaExceededUpgradeUrl(adminPortalUrl?: string): string {
  const adminPortal = adminPortalUrl?.trim().replace(/\/+$/, "");
  return adminPortal ? `${adminPortal}/billing` : "https://coop-ai.dev/pricing";
}

export type QuotaCreditsSnapshot = {
  remainingTokens?: number;
  remainingCredits?: number;
  usedTokens?: number;
  limitTokens?: number;
  resetsAt?: string;
  retryAfterMs?: number;
};

/** True when the org has no AI credits left for a new request. */
export function isFreeQuotaExhausted(quota?: QuotaCreditsSnapshot | null): boolean {
  if (!quota) {
    return false;
  }
  if (typeof quota.remainingTokens === "number") {
    return quota.remainingTokens <= 0;
  }
  if (typeof quota.usedTokens === "number" && typeof quota.limitTokens === "number") {
    return quota.usedTokens >= quota.limitTokens;
  }
  if (typeof quota.remainingCredits === "number") {
    return quota.remainingCredits <= 0;
  }
  return false;
}

export function isPaidUsageExhausted(
  meters?: {
    auto: { remainingCents: number };
    frontier: { remainingCents: number };
  } | null
): boolean {
  if (!meters) {
    return false;
  }
  return meters.auto.remainingCents <= 0 && meters.frontier.remainingCents <= 0;
}
