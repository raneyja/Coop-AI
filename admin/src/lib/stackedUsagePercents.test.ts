import assert from "node:assert/strict";
import { stackedUsagePercents } from "./stackedUsagePercents";

assert.deepEqual(stackedUsagePercents(0, 0), { auto: 0, frontier: 0 });
assert.deepEqual(stackedUsagePercents(0.03, 0), { auto: 3, frontier: 0 });
assert.deepEqual(stackedUsagePercents(0, 0.03), { auto: 0, frontier: 3 });
const mixed = stackedUsagePercents(0.02, 0.01);
assert.equal(Math.round(mixed.auto + mixed.frontier), 3);

console.log("stackedUsagePercents: 1/1 tests passed");
