import assert from "node:assert/strict";
import {
  isFreeQuotaExhausted,
  normalizeQuotaSnapshot,
  quotaUsedPercent,
  resolveFreeQuotaCredits
} from "./quotaSnapshot";

const nestedFree = {
  plan: "free",
  usageTier: null,
  unlimited: false,
  quota: {
    plan: "free",
    usedTokens: 130_000,
    limitTokens: 80_000,
    remainingTokens: 0,
    usedCredits: 130,
    limitCredits: 80,
    remainingCredits: 0,
    windowHours: 5,
    resetsAt: "2026-09-04T01:57:00.000Z",
    retryAfterMs: 17_800_000
  }
};

const normalized = normalizeQuotaSnapshot(nestedFree);
assert.equal(normalized.usedCredits, 130);
assert.equal(normalized.limitCredits, 80);
assert.equal(normalized.remainingCredits, 0);
assert.equal(normalized.windowHours, 5);
assert.equal(normalized.resetsAt, "2026-09-04T01:57:00.000Z");

const credits = resolveFreeQuotaCredits(nestedFree);
assert.ok(credits);
assert.equal(credits.usedCredits, 130);
assert.equal(credits.limitCredits, 80);
assert.equal(isFreeQuotaExhausted(credits), true);
assert.equal(quotaUsedPercent(130, 80), 100);
assert.equal(quotaUsedPercent(12, 80), 15);

const fromTokensOnly = resolveFreeQuotaCredits({
  plan: "free",
  quota: { usedTokens: 12_400, limitTokens: 80_000, remainingTokens: 67_600 }
});
assert.equal(fromTokensOnly?.usedCredits, 13);
assert.equal(fromTokensOnly?.limitCredits, 80);
assert.equal(isFreeQuotaExhausted(fromTokensOnly!), false);

assert.equal(resolveFreeQuotaCredits({ plan: "free", unlimited: false }), null);
assert.equal(resolveFreeQuotaCredits(undefined), null);

console.log("quotaSnapshot: 1/1 tests passed");
