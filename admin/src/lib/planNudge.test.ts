import assert from "node:assert/strict";
import { displayUsageTierName, resolvePlanNudge } from "./planNudge";

assert.equal(resolvePlanNudge({ plan: "enterprise" }), null);
assert.equal(resolvePlanNudge({ plan: "enterprise", usageTier: "max" }), null);

const empty = resolvePlanNudge({ plan: null });
assert.equal(empty?.title, "Upgrade to Pro");
assert.equal(empty?.action, "checkout");

const free = resolvePlanNudge({ plan: "free" });
assert.equal(free?.title, "Upgrade to Pro");
assert.equal(free?.action, "checkout");

const pro = resolvePlanNudge({ plan: "pro", usageTier: "pro" });
assert.equal(pro?.title, "Upgrade to Pro+");
assert.equal(pro?.ctaLabel, "Upgrade to Pro+");
assert.equal(pro?.nextName, "Pro+");
assert.equal(pro?.action, "billing");

const missingTier = resolvePlanNudge({ plan: "pro" });
assert.equal(missingTier?.title, "Upgrade to Pro+");

const plus = resolvePlanNudge({ plan: "pro", usageTier: "pro_plus" });
assert.equal(plus?.title, "Upgrade to Max");

const max = resolvePlanNudge({ plan: "pro", usageTier: "max" });
assert.equal(max?.title, "Need more than Max?");
assert.equal(max?.ctaLabel, "Request Enterprise");

assert.equal(displayUsageTierName("pro_plus"), "Pro+");
assert.equal(displayUsageTierName("max"), "Max");

console.log("planNudge: 1/1 tests passed");
