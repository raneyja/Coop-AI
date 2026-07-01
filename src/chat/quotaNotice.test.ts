import assert from "node:assert/strict";
import {
  buildQuotaExceededUpgradeUrl,
  formatQuotaRetryClock,
  isFreeQuotaExhausted
} from "./quotaNotice";

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

console.log("quotaNotice: 1/1 tests passed");
