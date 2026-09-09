import assert from "node:assert/strict";
import {
  isFreeQuotaExhausted,
  normalizeQuotaSnapshot,
  paidSeatUsedPercent,
  quotaUsedPercent,
  resolveFreeQuotaCredits,
  seatStatValue
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

assert.equal(paidSeatUsedPercent(undefined), null);
assert.equal(
  paidSeatUsedPercent({
    usageMeters: {
      usedRatio: 0.41,
      auto: { usedRatio: 0.2 },
      frontier: { usedRatio: 0.21 }
    }
  }),
  41
);
assert.equal(
  paidSeatUsedPercent({
    usageMeters: {
      auto: { usedRatio: 0.1 },
      frontier: { usedRatio: 0.05 }
    }
  }),
  15
);
assert.equal(seatStatValue({ unlimited: true }), "No cap");
assert.equal(
  seatStatValue({
    usageMeters: { usedRatio: 0.04, auto: { usedRatio: 0.04 }, frontier: { usedRatio: 0 } }
  }),
  "4%"
);
assert.equal(seatStatValue({ plan: "free", usedCredits: 12, limitCredits: 80 }), "15%");

console.log("quotaSnapshot: 1/1 tests passed");
