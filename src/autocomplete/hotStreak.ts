const HOT_STREAK_DURATION_MS = 8_000;
const HOT_STREAK_KEYSTROKES = 3;
const HOT_STREAK_MAX_DEBOUNCE_MS = 50;

/**
 * After the user accepts a suggestion, keep completions snappy for a short window.
 */
export class HotStreak {
  private streakCount = 0;
  private activeUntil = 0;
  private keystrokesRemaining = 0;

  public activate(): void {
    this.streakCount += 1;
    this.activeUntil = Date.now() + HOT_STREAK_DURATION_MS;
    this.keystrokesRemaining = HOT_STREAK_KEYSTROKES;
  }

  public noteKeystroke(): void {
    if (this.keystrokesRemaining > 0) {
      this.keystrokesRemaining -= 1;
    }
  }

  public isActive(): boolean {
    if (Date.now() >= this.activeUntil) {
      return false;
    }
    return this.keystrokesRemaining > 0;
  }

  public getStreakCount(): number {
    return this.streakCount;
  }

  /** Reduced debounce (0–50ms) while the hot streak is active. */
  public debounceMs(baseMs: number): number {
    if (!this.isActive()) {
      return baseMs;
    }
    return Math.min(HOT_STREAK_MAX_DEBOUNCE_MS, Math.max(0, Math.floor(baseMs * 0.1)));
  }
}
