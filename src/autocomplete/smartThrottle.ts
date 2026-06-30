const MAX_KEYSTROKE_SAMPLES = 20;
const FAST_TYPING_CPS = 8;
const MODERATE_TYPING_CPS = 4;
const HIGH_LATENCY_P95_MS = 500;
const ELEVATED_LATENCY_P95_MS = 300;

/**
 * Adaptive debounce based on recent typing speed and rolling p95 latency.
 */
export class SmartThrottle {
  private readonly keystrokeTimestamps: number[] = [];

  public noteKeystroke(): void {
    this.keystrokeTimestamps.push(Date.now());
    if (this.keystrokeTimestamps.length > MAX_KEYSTROKE_SAMPLES) {
      this.keystrokeTimestamps.shift();
    }
  }

  /** Estimated keystrokes per second over the recent sample window. */
  public typingSpeedCps(): number {
    if (this.keystrokeTimestamps.length < 2) {
      return 0;
    }
    const first = this.keystrokeTimestamps[0] ?? 0;
    const last = this.keystrokeTimestamps[this.keystrokeTimestamps.length - 1] ?? 0;
    const spanMs = last - first;
    if (spanMs <= 0) {
      return 0;
    }
    return ((this.keystrokeTimestamps.length - 1) / spanMs) * 1000;
  }

  public nextDelay(baseMs: number, p95LatencyMs: number): number {
    const speed = this.typingSpeedCps();
    let delay = baseMs;

    if (speed >= FAST_TYPING_CPS) {
      delay = Math.max(50, Math.floor(baseMs * 0.4));
    } else if (speed >= MODERATE_TYPING_CPS) {
      delay = Math.max(100, Math.floor(baseMs * 0.7));
    }

    if (p95LatencyMs >= HIGH_LATENCY_P95_MS) {
      delay = Math.min(800, delay + 150);
    } else if (p95LatencyMs >= ELEVATED_LATENCY_P95_MS) {
      delay = Math.min(600, delay + 75);
    }

    return delay;
  }
}
