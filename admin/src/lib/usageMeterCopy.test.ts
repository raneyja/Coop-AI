import assert from "node:assert/strict";
import {
  USAGE_METER_BASE_LABEL,
  USAGE_METER_FRONTIER_LABEL,
  USAGE_METER_HELPER,
  USAGE_METER_PERIOD_HINT
} from "./usageMeterCopy";

assert.equal(USAGE_METER_BASE_LABEL, "Base model");
assert.equal(USAGE_METER_FRONTIER_LABEL, "Frontier model");
assert.equal(USAGE_METER_BASE_LABEL.toLowerCase().includes("auto"), false);
assert.match(USAGE_METER_HELPER, /Base models use less/);
assert.match(USAGE_METER_HELPER, /Frontier models fill it faster/);
assert.doesNotMatch(USAGE_METER_HELPER, /\bAuto\b/);
assert.match(USAGE_METER_PERIOD_HINT, /Monthly included usage/);
assert.doesNotMatch(USAGE_METER_PERIOD_HINT, /\bAuto\b/);

console.log("usageMeterCopy: 1/1 tests passed");
