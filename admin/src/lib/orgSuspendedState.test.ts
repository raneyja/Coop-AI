import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearOrgSuspended,
  isOrgMarkedSuspended,
  markOrgSuspended,
  subscribeOrgSuspended
} from "./orgSuspendedState";

describe("orgSuspendedState", () => {
  it("latches suspended and notifies subscribers", () => {
    clearOrgSuspended();
    const seen: boolean[] = [];
    const unsub = subscribeOrgSuspended((value) => seen.push(value));
    markOrgSuspended();
    assert.equal(isOrgMarkedSuspended(), true);
    assert.deepEqual(seen, [true]);
    unsub();
    clearOrgSuspended();
    assert.equal(isOrgMarkedSuspended(), false);
  });

  it("does not leak across clear (sign-out / new org login)", () => {
    clearOrgSuspended();
    markOrgSuspended();
    clearOrgSuspended();
    assert.equal(isOrgMarkedSuspended(), false);
    const seen: boolean[] = [];
    const unsub = subscribeOrgSuspended((value) => seen.push(value));
    // Late subscriber should not be told suspended after clear.
    assert.deepEqual(seen, []);
    unsub();
  });
});
