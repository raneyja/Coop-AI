import assert from "node:assert/strict";
import {
  USAGE_TIER_LIMITS,
  displayPlanName,
  effectiveUsageTier,
  nextUsageTier,
  parseUsageTier,
  usageTierFromStripePriceId,
  utcCalendarMonthRange
} from "./usageTiers";

assert.equal(parseUsageTier("pro_plus"), "pro_plus");
assert.equal(parseUsageTier("nope"), null);
assert.equal(effectiveUsageTier("pro", null), "pro");
assert.equal(effectiveUsageTier("free", "pro"), null);
assert.equal(effectiveUsageTier("enterprise", "max"), null);
assert.equal(nextUsageTier("pro"), "pro_plus");
assert.equal(nextUsageTier("pro_plus"), "max");
assert.equal(nextUsageTier("max"), "enterprise");
assert.equal(displayPlanName("free"), "Free");
assert.equal(displayPlanName("pro"), "Pro");
assert.equal(displayPlanName("pro_plus"), "Pro+");
assert.equal(displayPlanName("max"), "Max");
assert.equal(displayPlanName("enterprise"), "Enterprise");
assert.equal(USAGE_TIER_LIMITS.pro.costCents, 1500);
assert.equal(USAGE_TIER_LIMITS.pro_plus.costCents, 3750);
assert.equal(USAGE_TIER_LIMITS.max.costCents, 6500);
assert.equal(USAGE_TIER_LIMITS.max.seatPriceUsd, 100);

assert.equal(
  usageTierFromStripePriceId("price_plus", { pro: "price_pro", proPlus: "price_plus", max: "price_max" }),
  "pro_plus"
);
assert.equal(
  usageTierFromStripePriceId("price_unknown", { pro: "price_pro", proPlus: "price_plus", max: "price_max" }),
  "pro"
);

const range = utcCalendarMonthRange(new Date("2026-09-15T12:00:00.000Z"));
assert.equal(range.from.toISOString(), "2026-09-01T00:00:00.000Z");
assert.equal(range.to.toISOString(), "2026-10-01T00:00:00.000Z");

console.log("usageTiers: 1/1 tests passed");
