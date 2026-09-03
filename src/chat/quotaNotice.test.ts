import assert from "node:assert/strict";
import {
  buildQuotaExceededUpgradeUrl,
  formatQuotaRetryClock,
  isFreeQuotaExhausted,
  isPaidUsageExhausted,
  PAID_USAGE_EXHAUSTED_COPY
} from "./quotaNotice";
import { buildFrontierEmptyMessage } from "../server/planQuota";

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

assert.equal(
  isPaidUsageExhausted({ auto: { remainingCents: 0 }, frontier: { remainingCents: 0 } }),
  true
);
assert.equal(
  isPaidUsageExhausted({ auto: { remainingCents: 10 }, frontier: { remainingCents: 0 } }),
  false
);
assert.equal(PAID_USAGE_EXHAUSTED_COPY.includes("unlimited"), false);
assert.match(buildFrontierEmptyMessage("pro_plus", true), /Switch to Auto/);
assert.match(buildFrontierEmptyMessage("pro_plus", true), /Pro\+/);
assert.match(buildFrontierEmptyMessage(undefined, false), /Enterprise/);

console.log("quotaNotice: 1/1 tests passed");
