export type PaidUsageResetParts = {
  dateLabel: string;
  countdown: string;
};

/** Local calendar-day countdown. Keep in sync with src/chat/quotaNotice.ts. */
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

/** Keep in sync with src/webview/components/settings/connectionCopy.ts. */
export function formatQuotaUsageSummary(
  quota: {
    usedCredits: number;
    limitCredits: number;
    remainingCredits: number;
    windowHours: number;
  },
  options?: { exhausted?: boolean }
): string {
  const used = quota.usedCredits ?? Math.max(0, quota.limitCredits - quota.remainingCredits);
  const counts = `${used}K of ${quota.limitCredits}K AI credits used`;
  if (options?.exhausted) {
    return counts;
  }
  return `${counts} - ${quota.windowHours}-hour rolling window`;
}

export type FreeQuotaResumeParts = {
  pausedAtLabel: string;
  resumesAtLabel: string;
  countdown: string;
};

/** Keep in sync with src/chat/quotaNotice.ts. */
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

function calendarDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatClock(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleString(undefined, options);
}

export function formatFreeQuotaResumeParts(
  input: { resetsAt?: string; windowHours?: number },
  now = new Date()
): FreeQuotaResumeParts | null {
  if (!input.resetsAt) {
    return null;
  }
  const resetsAt = new Date(input.resetsAt);
  if (Number.isNaN(resetsAt.getTime())) {
    return null;
  }
  const windowMs = Math.max(1, (input.windowHours ?? 5) * 3_600_000);
  const pausedAt = new Date(resetsAt.getTime() - windowMs);
  const resumeNeedsDate = calendarDateKey(resetsAt) !== calendarDateKey(now);
  const pauseNeedsDate = calendarDateKey(pausedAt) !== calendarDateKey(now);
  const clock = (includeDate: boolean): Intl.DateTimeFormatOptions => ({
    hour: "numeric",
    minute: "2-digit",
    ...(includeDate ? { month: "short", day: "numeric" } : {})
  });
  return {
    pausedAtLabel: formatClock(pausedAt, clock(pauseNeedsDate)),
    resumesAtLabel: formatClock(resetsAt, { ...clock(resumeNeedsDate), timeZoneName: "short" }),
    countdown: formatFreeQuotaCountdown(resetsAt.getTime() - now.getTime())
  };
}

export function formatFreeQuotaResumeCopy(
  input: { resetsAt?: string; windowHours?: number },
  now = new Date()
): string | null {
  const parts = formatFreeQuotaResumeParts(input, now);
  if (!parts) {
    return null;
  }
  return `Paused at ${parts.pausedAtLabel} · resumes at ${parts.resumesAtLabel} (${parts.countdown})`;
}

function calendarDaysUntil(end: Date, now: Date): number {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.round((startOfEnd.getTime() - startOfToday.getTime()) / 86_400_000));
}
