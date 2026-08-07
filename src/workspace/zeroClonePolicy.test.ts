import assert from "node:assert/strict";
import { mayReadLocalRepoDiskForIntelligence, ZERO_CLONE } from "./zeroClonePolicy";

assert.equal(ZERO_CLONE, true);
assert.equal(mayReadLocalRepoDiskForIntelligence(), false);
console.log("zeroClonePolicy: 1/1 tests passed");
