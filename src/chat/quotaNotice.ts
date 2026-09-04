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

/** Local calendar-day countdown. Keep in sync with admin/src/lib/usageResetCopy.ts. */
export function formatPaidUsageResetCopy(
  periodEndIso: string | undefined,
  now = new Date()
): string | null {
  if (!periodEndIso) {
    return null;
  }
  const end = new Date(periodEndIso);
  if (Number.isNaN(end.getTime())) {
    return null;
  }
  const dateLabel = end.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const daysLeft = calendarDaysUntil(end, now);
  const countdown = daysLeft === 0 ? "today" : daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
  return `Usage limits reset on ${dateLabel} (${countdown})`;
}

function calendarDaysUntil(end: Date, now: Date): number {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.round((startOfEnd.getTime() - startOfToday.getTime()) / 86_400_000));
}

export function isPaidQuotaPool(pool?: string): boolean {
  return pool === "paid" || pool === "auto" || pool === "frontier";
}

export function isPaidUsageExhausted(
  meters?: {
    remainingCents?: number;
    usedCents?: number;
    limitCents?: number;
    auto?: { usedCents?: number; remainingCents?: number };
    frontier?: { usedCents?: number; remainingCents?: number };
  } | null
): boolean {
  if (!meters) {
    return false;
  }
  if (typeof meters.remainingCents === "number") {
    return meters.remainingCents <= 0;
  }
  if (typeof meters.usedCents === "number" && typeof meters.limitCents === "number") {
    return meters.usedCents >= meters.limitCents;
  }
  const used = (meters.auto?.usedCents ?? 0) + (meters.frontier?.usedCents ?? 0);
  if (typeof meters.limitCents === "number") {
    return used >= meters.limitCents;
  }
  if (typeof meters.auto?.remainingCents === "number" && typeof meters.frontier?.remainingCents === "number") {
    return meters.auto.remainingCents <= 0 && meters.frontier.remainingCents <= 0;
  }
  return false;
}
