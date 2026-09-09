import assert from "node:assert/strict";
import {
  demoSeatUsageForIndex,
  hasVisibleSeatUsage,
  isLocalAdminHost,
  resolveSeatUsageMeters
} from "./demoSeatUsage";

assert.equal(isLocalAdminHost("localhost"), true);
assert.equal(isLocalAdminHost("127.0.0.1"), true);
assert.equal(isLocalAdminHost("admin.coop-ai.dev"), false);

assert.equal(hasVisibleSeatUsage(null), false);
assert.equal(hasVisibleSeatUsage({ usedRatio: 0 }), false);
assert.equal(hasVisibleSeatUsage({ usedRatio: 0.12 }), true);

const heavy = demoSeatUsageForIndex(0);
const light = demoSeatUsageForIndex(1);
assert.ok((heavy.frontier?.usedRatio ?? 0) > 0);
assert.equal(light.frontier?.usedRatio, 0);
assert.deepEqual(demoSeatUsageForIndex(2), heavy);

const localEmpty = resolveSeatUsageMeters({ meters: null, index: 0, hostname: "localhost" });
assert.equal(localEmpty.sample, true);
assert.equal(localEmpty.meters.usedRatio, heavy.usedRatio);

const prodEmpty = resolveSeatUsageMeters({ meters: null, index: 0, hostname: "admin.coop-ai.dev" });
assert.equal(prodEmpty.sample, false);
assert.equal(prodEmpty.meters.usedRatio, 0);

const real = resolveSeatUsageMeters({
  meters: { usedRatio: 0.3, auto: { usedRatio: 0.3 }, frontier: { usedRatio: 0 } },
  index: 0,
  hostname: "localhost"
});
assert.equal(real.sample, false);
assert.equal(real.meters.usedRatio, 0.3);

console.log("demoSeatUsage: 1/1 tests passed");
