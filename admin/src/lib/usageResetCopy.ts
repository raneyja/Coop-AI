/** Local calendar-day countdown. Keep in sync with src/chat/quotaNotice.ts. */
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
