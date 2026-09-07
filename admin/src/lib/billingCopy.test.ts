import assert from "node:assert/strict";
import {
  addSeatsCopy,
  billingAccountRow,
  billingPageSubtitle,
  isSoloSeatCount,
  newSeatTotalPreview,
  normalizeSeatCount,
  upgradeSeatCountNote,
  usersBillingLink,
  usersInviteDisabledTitle,
  usersPageSubtitle,
  usersRepoAccessHint,
  usersSeatsPanelCopy
} from "./billingCopy";

assert.equal(normalizeSeatCount(undefined), 1);
assert.equal(normalizeSeatCount(null), 1);
assert.equal(normalizeSeatCount(0), 1);
assert.equal(normalizeSeatCount(1.9), 1);
assert.equal(normalizeSeatCount(8), 8);
assert.equal(isSoloSeatCount(1), true);
assert.equal(isSoloSeatCount(undefined), true);
assert.equal(isSoloSeatCount(8), false);

assert.equal(billingPageSubtitle(true), "Plan and subscription.");
assert.equal(billingPageSubtitle(false), "Plan, seats, and subscription management.");

assert.deepEqual(billingAccountRow(1, true), { label: "Account", value: "Just you" });
assert.deepEqual(billingAccountRow(8, false), { label: "Seats", value: "8" });

const soloAdd = addSeatsCopy({ solo: true, currentSeats: 1, addCount: 1 });
assert.equal(soloAdd.title, "Add a teammate");
assert.equal(soloAdd.cta, "Add a teammate");
assert.equal(soloAdd.showReduceNote, false);
assert.match(soloAdd.body, /only person/i);

const soloAddMany = addSeatsCopy({ solo: true, currentSeats: 1, addCount: 4 });
assert.equal(soloAddMany.cta, "Add seats");

const teamAdd = addSeatsCopy({ solo: false, currentSeats: 8, addCount: 1 });
assert.equal(teamAdd.title, "Add seats");
assert.equal(teamAdd.cta, "Add seats");
assert.equal(teamAdd.showReduceNote, true);
assert.match(teamAdd.body, /8 seats/);

assert.equal(newSeatTotalPreview(1, 1), "New total after confirm: 2 seats.");
assert.equal(newSeatTotalPreview(8, 0), null);
assert.equal(newSeatTotalPreview(8, Number.NaN), null);

assert.equal(
  upgradeSeatCountNote(true, "Pro+"),
  "Opens Stripe so you can switch to Pro+. Your seat stays the same."
);
assert.equal(
  upgradeSeatCountNote(false, "Pro+"),
  "Opens Stripe so you can switch to Pro+. Seat count stays the same."
);

assert.match(usersPageSubtitle({ free: true, solo: true }), /individual only/);
assert.match(usersPageSubtitle({ free: false, solo: true }), /Just you/);
assert.match(usersPageSubtitle({ free: false, solo: false }), /team members/);

const soloSeats = usersSeatsPanelCopy({
  free: false,
  solo: true,
  seats: 1,
  seatsUsed: 1,
  seatsAvailable: 0,
  atCapacity: true
});
assert.equal(soloSeats.justYou, true);
assert.equal(soloSeats.heading, "Account");
assert.equal(soloSeats.assignedLine, null);
assert.match(soloSeats.hint, /Billing/);

const teamSeats = usersSeatsPanelCopy({
  free: false,
  solo: false,
  seats: 8,
  seatsUsed: 3,
  seatsAvailable: 5,
  atCapacity: false
});
assert.equal(teamSeats.justYou, false);
assert.equal(teamSeats.assignedLine?.used, "3");
assert.equal(teamSeats.assignedLine?.total, "8");
assert.equal(teamSeats.hint, "5 available");

assert.deepEqual(usersBillingLink({ free: true, solo: true, atCapacity: true }), {
  label: "Upgrade for team seats →",
  emphasized: false
});
assert.deepEqual(usersBillingLink({ free: false, solo: true, atCapacity: true }), {
  label: "Manage billing →",
  emphasized: false
});
assert.deepEqual(usersBillingLink({ free: false, solo: false, atCapacity: true }), {
  label: "Add seats",
  emphasized: true
});
assert.deepEqual(usersBillingLink({ free: false, solo: false, atCapacity: false }), {
  label: "Manage billing →",
  emphasized: false
});

assert.match(usersInviteDisabledTitle(true), /Add a seat/);
assert.match(usersInviteDisabledTitle(false), /All seats are assigned/);

assert.match(usersRepoAccessHint({ solo: true, perUserAccess: false }), /Your Deep-Indexed repos/);
assert.match(usersRepoAccessHint({ solo: false, perUserAccess: false }), /Every team member/);
assert.match(usersRepoAccessHint({ solo: true, perUserAccess: true }), /Assign repos/);

console.log("billingCopy: 1/1 tests passed");
