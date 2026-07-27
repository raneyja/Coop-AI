const DISMISS_UNTIL_KEY = "coop.adminOnboarding.dismissedUntil";
const DISMISS_COUNT_KEY = "coop.adminOnboarding.dismissCount";
const PERMANENT_KEY = "coop.adminOnboarding.permanentlyDismissed";
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000;
const PERMANENT_AFTER_DISMISSES = 3;

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function readDismissCount(): number {
  if (!canUseStorage()) {
    return 0;
  }
  const raw = localStorage.getItem(DISMISS_COUNT_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function writeDismissCount(count: number): void {
  if (!canUseStorage()) {
    return;
  }
  localStorage.setItem(DISMISS_COUNT_KEY, String(count));
}

function writeDismissedUntil(untilMs: number): void {
  if (!canUseStorage()) {
    return;
  }
  localStorage.setItem(DISMISS_UNTIL_KEY, String(untilMs));
}

export function isOnboardingBannerPermanentlyDismissed(): boolean {
  if (!canUseStorage()) {
    return false;
  }
  return localStorage.getItem(PERMANENT_KEY) === "1";
}

export function isOnboardingBannerDismissedTemporarily(): boolean {
  if (!canUseStorage()) {
    return false;
  }
  const raw = localStorage.getItem(DISMISS_UNTIL_KEY);
  const until = raw ? Number.parseInt(raw, 10) : 0;
  if (!Number.isFinite(until)) {
    return false;
  }
  return Date.now() < until;
}

export function clearOnboardingBannerDismiss(): void {
  if (!canUseStorage()) {
    return;
  }
  localStorage.removeItem(DISMISS_UNTIL_KEY);
  localStorage.removeItem(DISMISS_COUNT_KEY);
  localStorage.removeItem(PERMANENT_KEY);
}

/**
 * Record an explicit dismiss. Hides the banner for 24 hours on dismisses 1–2.
 * On the 3rd dismiss, returns permanent=true so the caller can mark org setup complete.
 */
export function recordOnboardingBannerDismiss(): { permanent: boolean; count: number } {
  const count = readDismissCount() + 1;
  writeDismissCount(count);

  if (count >= PERMANENT_AFTER_DISMISSES) {
    if (canUseStorage()) {
      localStorage.setItem(PERMANENT_KEY, "1");
      localStorage.removeItem(DISMISS_UNTIL_KEY);
    }
    return { permanent: true, count };
  }

  writeDismissedUntil(Date.now() + DISMISS_DURATION_MS);
  return { permanent: false, count };
}
