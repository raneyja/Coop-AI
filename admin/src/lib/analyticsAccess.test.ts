import assert from "node:assert/strict";
import { shouldShowOrganizationAnalytics } from "./analyticsAccess";

assert.equal(shouldShowOrganizationAnalytics(true, 1), false);
assert.equal(shouldShowOrganizationAnalytics(true, 2), true);
assert.equal(shouldShowOrganizationAnalytics(true, 5), true);
assert.equal(shouldShowOrganizationAnalytics(false, 5), false);
assert.equal(shouldShowOrganizationAnalytics(true, null), false);
assert.equal(shouldShowOrganizationAnalytics(true, undefined), false);
assert.equal(shouldShowOrganizationAnalytics(true, 0), false);

console.log("analyticsAccess: 1/1 tests passed");
