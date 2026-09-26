export type PlanUpgradePollResult =
  | { status: "upgraded"; plan: string }
  | { status: "timeout" }
  | { status: "cancelled" };

export type PlanUpgradePollOptions = {
  /** Default 2000. */
  intervalMs?: number;
  /** Default 60_000. Hard stop — never infinite. */
  maxMs?: number;
  signal?: AbortSignal;
  fetchPlan: () => Promise<string>;
  /** Default: pro or enterprise. */
  isTargetPlan?: (plan: string) => boolean;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_MAX_MS = 60_000;

export function isPaidPlanAfterUpgrade(plan: string): boolean {
  return plan === "pro" || plan === "enterprise";
}

/**
 * Bounded poll after Stripe Checkout opens. Stops on paid plan, timeout, or abort (cancel).
 */
export async function pollUntilPaidPlan(options: PlanUpgradePollOptions): Promise<PlanUpgradePollResult> {
  const intervalMs = Math.max(250, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const maxMs = Math.max(intervalMs, options.maxMs ?? DEFAULT_MAX_MS);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepWithSignal;
  const isTarget = options.isTargetPlan ?? isPaidPlanAfterUpgrade;
  const started = now();

  if (options.signal?.aborted) {
    return { status: "cancelled" };
  }

  while (now() - started < maxMs) {
    if (options.signal?.aborted) {
      return { status: "cancelled" };
    }
    let plan = "free";
    try {
      plan = await options.fetchPlan();
    } catch {
      // Keep polling through transient /me failures during webhook lag.
    }
    if (isTarget(plan)) {
      return { status: "upgraded", plan };
    }
    const remaining = maxMs - (now() - started);
    if (remaining <= 0) {
      break;
    }
    try {
      await sleep(Math.min(intervalMs, remaining), options.signal);
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return { status: "cancelled" };
      }
      throw error;
    }
  }

  if (options.signal?.aborted) {
    return { status: "cancelled" };
  }
  return { status: "timeout" };
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
