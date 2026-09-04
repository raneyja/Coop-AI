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

export type FreeQuotaResumeParts = {
  pausedAtLabel: string;
  resumesAtLabel: string;
  countdown: string;
};

export function formatFreeQuotaCountdown(ms: number): string {
  if (ms <= 0) {
    return "available now";
  }
  if (ms < 60_000) {
    return "less than a minute";
  }
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) {
    return totalMinutes === 1 ? "1 minute left" : `${totalMinutes} minutes left`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes <= 0) {
    return hours === 1 ? "1 hour left" : `${hours} hours left`;
  }
  return `${hours}h ${minutes}m left`;
}

function calendarDateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function clockOptions(includeDate: boolean): Intl.DateTimeFormatOptions {
  return {
    hour: "numeric",
    minute: "2-digit",
    ...(includeDate ? { month: "short", day: "numeric" } : {})
  };
}

/** Pause + resume labels for a full free rolling window. */
export function formatFreeQuotaResumeParts(
  input: { resetsAt?: string; windowHours?: number; timezone?: string },
  now = new Date()
): FreeQuotaResumeParts | null {
  if (!input.resetsAt) {
    return null;
  }
  const resetsAt = new Date(input.resetsAt);
  if (Number.isNaN(resetsAt.getTime())) {
    return null;
  }
  const timezone = resolveTimezone(input.timezone);
  const windowMs = Math.max(1, (input.windowHours ?? 5) * 3_600_000);
  const pausedAt = new Date(resetsAt.getTime() - windowMs);
  const resumeNeedsDate = calendarDateKey(resetsAt, timezone) !== calendarDateKey(now, timezone);
  const pauseNeedsDate = calendarDateKey(pausedAt, timezone) !== calendarDateKey(now, timezone);
  const pausedAtLabel =
    formatTimeInTimezone(pausedAt.toISOString(), timezone, clockOptions(pauseNeedsDate)) ?? "earlier";
  const resumesAtLabel =
    formatTimeInTimezone(input.resetsAt, timezone, {
      ...clockOptions(resumeNeedsDate),
      timeZoneName: "short"
    }) ?? "later";
  return {
    pausedAtLabel,
    resumesAtLabel,
    countdown: formatFreeQuotaCountdown(resetsAt.getTime() - now.getTime())
  };
}

export function formatFreeQuotaResumeCopy(
  input: { resetsAt?: string; windowHours?: number; timezone?: string },
  now = new Date()
): string | null {
  const parts = formatFreeQuotaResumeParts(input, now);
  if (!parts) {
    return null;
  }
  return `Paused at ${parts.pausedAtLabel} · resumes at ${parts.resumesAtLabel} (${parts.countdown})`;
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

export type PaidUsageResetParts = {
  dateLabel: string;
  countdown: string;
};

/** Local calendar-day countdown. Keep in sync with admin/src/lib/usageResetCopy.ts. */
export function formatPaidUsageResetParts(
  periodEndIso: string | undefined,
  now = new Date()
): PaidUsageResetParts | null {
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
  return { dateLabel, countdown };
}

export function formatPaidUsageResetCopy(
  periodEndIso: string | undefined,
  now = new Date()
): string | null {
  const parts = formatPaidUsageResetParts(periodEndIso, now);
  if (!parts) {
    return null;
  }
  return `Usage limits reset on ${parts.dateLabel} (${parts.countdown})`;
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
