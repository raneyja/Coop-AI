import assert from "node:assert/strict";
import {
  clampSeatCountForPlan,
  codeHostPlansForProvider,
  CODE_HOST_GITHUB_PLANS
} from "./planGates";

assert.equal(clampSeatCountForPlan("free", 5), 1);
assert.equal(clampSeatCountForPlan("free", 0), 1);
assert.equal(clampSeatCountForPlan("pro", 3), 3);
assert.equal(clampSeatCountForPlan("enterprise", 0), 1);

assert.deepEqual(codeHostPlansForProvider("github"), CODE_HOST_GITHUB_PLANS);
assert.ok(codeHostPlansForProvider("github").includes("free"));
assert.deepEqual(codeHostPlansForProvider("gitlab"), ["enterprise"]);
assert.deepEqual(codeHostPlansForProvider("bitbucket"), ["enterprise"]);

console.log("planGates.test.ts: ok");
