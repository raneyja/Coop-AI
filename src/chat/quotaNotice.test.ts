import assert from "node:assert/strict";
import {
  buildQuotaExceededUpgradeUrl,
  formatPaidUsageResetCopy,
  formatQuotaRetryClock,
  isFreeQuotaExhausted,
  isPaidQuotaPool,
  isPaidUsageExhausted,
  PAID_USAGE_EXHAUSTED_COPY
} from "./quotaNotice";
import { buildPaidCapMessage } from "../server/planQuota";

const resetsAt = "2026-07-01T21:37:00.000Z";

assert.equal(
  formatQuotaRetryClock(resetsAt, "America/Los_Angeles"),
  new Date(resetsAt).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles"
  })
);

assert.equal(buildQuotaExceededUpgradeUrl("https://admin.coop-ai.dev/"), "https://admin.coop-ai.dev/billing");
assert.equal(buildQuotaExceededUpgradeUrl(undefined), "https://coop-ai.dev/pricing");

assert.equal(isFreeQuotaExhausted({ remainingTokens: 0 }), true);
assert.equal(isFreeQuotaExhausted({ remainingTokens: 500 }), false);
assert.equal(isFreeQuotaExhausted({ usedTokens: 80_000, limitTokens: 80_000 }), true);
assert.equal(isFreeQuotaExhausted({ usedTokens: 56_287, limitTokens: 80_000 }), false);
assert.equal(isFreeQuotaExhausted({ remainingCredits: 0 }), true);

assert.equal(isPaidQuotaPool("paid"), true);
assert.equal(isPaidQuotaPool("auto"), true);
assert.equal(isPaidQuotaPool("frontier"), true);
assert.equal(isPaidQuotaPool("free"), false);

assert.equal(isPaidUsageExhausted({ remainingCents: 0 }), true);
assert.equal(isPaidUsageExhausted({ remainingCents: 10 }), false);
assert.equal(
  isPaidUsageExhausted({
    remainingCents: 0,
    auto: { remainingCents: 10 },
    frontier: { remainingCents: 0 }
  }),
  true
);
assert.equal(
  isPaidUsageExhausted({ auto: { remainingCents: 10 }, frontier: { remainingCents: 0 } }),
  false
);
assert.equal(PAID_USAGE_EXHAUSTED_COPY.includes("unlimited"), false);
assert.match(buildPaidCapMessage("pro_plus"), /Upgrade to Pro\+/);
assert.match(buildPaidCapMessage(undefined), /Enterprise/);

const periodEnd = "2026-09-06T17:00:00.000Z";
const resetDateLabel = new Date(periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" });
assert.equal(
  formatPaidUsageResetCopy(periodEnd, new Date("2026-09-03T17:00:00.000Z")),
  `Usage limits reset on ${resetDateLabel} (3 days left)`
);
assert.equal(
  formatPaidUsageResetCopy(periodEnd, new Date("2026-09-05T17:00:00.000Z")),
  `Usage limits reset on ${resetDateLabel} (1 day left)`
);
assert.equal(
  formatPaidUsageResetCopy(periodEnd, new Date("2026-09-06T17:00:00.000Z")),
  `Usage limits reset on ${resetDateLabel} (today)`
);
assert.equal(formatPaidUsageResetCopy(undefined), null);
assert.equal(formatPaidUsageResetCopy("not-a-date"), null);

console.log("quotaNotice: 1/1 tests passed");
