const STORAGE_PREFIX = "coop.setupDismiss";

type SetupKind = "admin" | "member";

function storageKey(kind: SetupKind, suffix: string): string {
  return `${STORAGE_PREFIX}.${kind}.${suffix}`;
}

function todayKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeyFromOffset(offsetDays: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfTomorrowMs(): number {
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getTime();
}

function readDismissDates(kind: SetupKind): string[] {
  try {
    const raw = localStorage.getItem(storageKey(kind, "dates"));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function writeDismissDates(kind: SetupKind, dates: string[]): void {
  try {
    localStorage.setItem(storageKey(kind, "dates"), JSON.stringify(dates));
  } catch {
    // ignore
  }
}

function readDismissedUntil(kind: SetupKind): number {
  try {
    const raw = localStorage.getItem(storageKey(kind, "until"));
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeDismissedUntil(kind: SetupKind, untilMs: number): void {
  try {
    localStorage.setItem(storageKey(kind, "until"), String(untilMs));
  } catch {
    // ignore
  }
}

function countConsecutiveDismissDaysEndingToday(dates: string[]): number {
  const today = todayKey();
  if (!dates.includes(today)) {
    return 0;
  }
  let streak = 1;
  for (let offset = -1; offset >= -6; offset -= 1) {
    const key = dateKeyFromOffset(offset);
    if (dates.includes(key)) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

export function isSetupDismissedToday(kind: SetupKind): boolean {
  const until = readDismissedUntil(kind);
  return until > Date.now();
}

export function clearSetupDismiss(kind: SetupKind): void {
  try {
    localStorage.removeItem(storageKey(kind, "until"));
    localStorage.removeItem(storageKey(kind, "dates"));
  } catch {
    // ignore
  }
}

/**
 * Record an explicit dismiss (X or backdrop). Hides setup until the next calendar day.
 * After 3 consecutive dismiss days, returns permanent=true so the caller can mark setup complete.
 */
export function recordSetupDismiss(kind: SetupKind): { permanent: boolean } {
  const today = todayKey();
  const dates = readDismissDates(kind);
  if (!dates.includes(today)) {
    dates.push(today);
    dates.sort();
    writeDismissDates(kind, dates);
  }

  const streak = countConsecutiveDismissDaysEndingToday(dates);
  if (streak >= 3) {
    clearSetupDismiss(kind);
    return { permanent: true };
  }

  writeDismissedUntil(kind, startOfTomorrowMs());
  return { permanent: false };
}
