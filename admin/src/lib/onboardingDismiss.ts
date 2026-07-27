const STORAGE_PREFIX = "coop.setupDismiss";
const PERMANENT_AFTER_DISMISSES = 3;

type SetupKind = "admin" | "member";

function storageKey(kind: SetupKind, suffix: string): string {
  return `${STORAGE_PREFIX}.${kind}.${suffix}`;
}

function startOfTomorrowMs(): number {
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getTime();
}

function readDismissCount(kind: SetupKind): number {
  try {
    const rawCount = localStorage.getItem(storageKey(kind, "count"));
    if (rawCount) {
      const parsed = Number(rawCount);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    // Migrate legacy consecutive-day date list → count.
    const rawDates = localStorage.getItem(storageKey(kind, "dates"));
    if (!rawDates) {
      return 0;
    }
    const parsed = JSON.parse(rawDates) as unknown;
    if (!Array.isArray(parsed)) {
      return 0;
    }
    return parsed.filter((entry): entry is string => typeof entry === "string").length;
  } catch {
    return 0;
  }
}

function writeDismissCount(kind: SetupKind, count: number): void {
  try {
    localStorage.setItem(storageKey(kind, "count"), String(count));
    localStorage.removeItem(storageKey(kind, "dates"));
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

export function isSetupDismissedToday(kind: SetupKind): boolean {
  const until = readDismissedUntil(kind);
  return until > Date.now();
}

export function clearSetupDismiss(kind: SetupKind): void {
  try {
    localStorage.removeItem(storageKey(kind, "until"));
    localStorage.removeItem(storageKey(kind, "dates"));
    localStorage.removeItem(storageKey(kind, "count"));
  } catch {
    // ignore
  }
}

/**
 * Record an explicit dismiss (X or backdrop). Hides setup until the next calendar day.
 * After 3 dismisses total, returns permanent=true so the caller can mark setup complete.
 */
export function recordSetupDismiss(kind: SetupKind): { permanent: boolean } {
  const count = readDismissCount(kind) + 1;
  writeDismissCount(kind, count);

  if (count >= PERMANENT_AFTER_DISMISSES) {
    clearSetupDismiss(kind);
    return { permanent: true };
  }

  writeDismissedUntil(kind, startOfTomorrowMs());
  return { permanent: false };
}
