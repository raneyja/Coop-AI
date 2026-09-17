import assert from "node:assert/strict";
import {
  billingEmailBelongsToOrg,
  billingEmailOptions,
  resolveBillingContact
} from "./billingEmail";

const older = new Date("2026-01-01T00:00:00.000Z");
const newer = new Date("2026-06-01T00:00:00.000Z");

const jonathan = {
  email: "jonathanaraney@gmail.com",
  role: "admin",
  createdAt: older,
  deactivatedAt: null
};
const doxel = {
  email: "jonathan.raney@doxel.ai",
  role: "member",
  createdAt: newer,
  deactivatedAt: null
};
const leaked = "raneysoftware@gmail.com";

assert.deepEqual(billingEmailOptions([doxel, jonathan]), [
  "jonathanaraney@gmail.com",
  "jonathan.raney@doxel.ai"
]);

const kept = resolveBillingContact({
  storedEmail: "JonathanAraney@gmail.com",
  users: [jonathan, doxel]
});
assert.equal(kept.email, "jonathanaraney@gmail.com");
assert.equal(kept.healed, false);

const foreign = resolveBillingContact({
  storedEmail: leaked,
  users: [jonathan, doxel]
});
assert.equal(foreign.email, "jonathanaraney@gmail.com");
assert.equal(foreign.healed, true);
assert.equal(billingEmailBelongsToOrg(leaked, [jonathan, doxel]), false);
assert.equal(billingEmailBelongsToOrg("jonathanaraney@gmail.com", [jonathan, doxel]), true);

const empty = resolveBillingContact({
  storedEmail: null,
  users: [jonathan, doxel]
});
assert.equal(empty.email, "jonathanaraney@gmail.com");
assert.equal(empty.healed, true);

const deactivatedFounder = resolveBillingContact({
  storedEmail: leaked,
  users: [
    { ...jonathan, deactivatedAt: newer },
    doxel
  ]
});
assert.equal(deactivatedFounder.email, "jonathan.raney@doxel.ai");
assert.equal(deactivatedFounder.healed, true);

const noUsers = resolveBillingContact({ storedEmail: leaked, users: [] });
assert.equal(noUsers.email, undefined);
assert.equal(noUsers.healed, false);

console.log("billingEmail: 1/1 tests passed");
