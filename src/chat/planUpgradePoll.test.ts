import assert from "node:assert/strict";
import { isPaidPlanAfterUpgrade, pollUntilPaidPlan } from "./planUpgradePoll";

assert.equal(isPaidPlanAfterUpgrade("pro"), true);
assert.equal(isPaidPlanAfterUpgrade("enterprise"), true);
assert.equal(isPaidPlanAfterUpgrade("free"), false);

async function run(): Promise<void> {
  let clock = 0;
  const plans = ["free", "free", "pro"];
  let fetches = 0;
  const result = await pollUntilPaidPlan({
    intervalMs: 2_000,
    maxMs: 60_000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetchPlan: async () => {
      const plan = plans[Math.min(fetches, plans.length - 1)]!;
      fetches += 1;
      return plan;
    }
  });
  assert.equal(result.status, "upgraded");
  if (result.status === "upgraded") {
    assert.equal(result.plan, "pro");
  }
  assert.equal(fetches, 3);

  clock = 0;
  let timeoutFetches = 0;
  const timedOut = await pollUntilPaidPlan({
    intervalMs: 2_000,
    maxMs: 6_000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetchPlan: async () => {
      timeoutFetches += 1;
      return "free";
    }
  });
  assert.equal(timedOut.status, "timeout");
  assert.ok(timeoutFetches >= 2);

  const controller = new AbortController();
  clock = 0;
  let cancelFetches = 0;
  const cancelPromise = pollUntilPaidPlan({
    intervalMs: 2_000,
    maxMs: 60_000,
    signal: controller.signal,
    now: () => clock,
    sleep: async (ms, signal) => {
      clock += ms;
      if (cancelFetches >= 1) {
        controller.abort();
      }
      if (signal?.aborted) {
        return;
      }
    },
    fetchPlan: async () => {
      cancelFetches += 1;
      return "free";
    }
  });
  const cancelled = await cancelPromise;
  assert.equal(cancelled.status, "cancelled");

  console.log("planUpgradePoll: 1/1 tests passed");
}

void run();
