import assert from "node:assert/strict";
import {
  addSeatsCopy,
  billingAccountRow,
  billingPageSubtitle,
  billingPlanLabel,
  billingPlanDetailLine,
  billingSeatBreakdown,
  billingStatusDisplay,
  seatPriceLabel,
  SEAT_PRICES_USD,
  convertSeatModalCopy,
  convertSeatPreview,
  seatConvertErrorCopy,
  seatConvertProcessingCopy,
  seatConvertSuccessCopy,
  upgradeRequestNoticeCopy,
  isSoloSeatCount,
  newSeatTotalPreview,
  normalizeSeatCount,
  seatMixLine,
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

assert.equal(billingPlanLabel({ plan: "free" }), "Free");
assert.equal(billingPlanLabel({ plan: "enterprise", seats: 40 }), "Enterprise");
assert.equal(billingPlanLabel({ plan: "pro", usageTier: "pro", seats: 1 }), "Pro");
assert.equal(billingPlanLabel({ plan: "pro", usageTier: "pro_plus", seats: 1 }), "Pro+");
assert.equal(billingPlanLabel({ plan: "pro", usageTier: "max", seats: 1 }), "Max");
assert.equal(billingPlanLabel({ plan: "pro", usageTier: "pro", seats: 2 }), "Team");
assert.equal(billingPlanLabel({ plan: "pro", usageTier: "max", seats: 8 }), "Team");
assert.equal(billingPlanLabel({ plan: "pro", usageTier: "pro_plus" }), "Pro+");
assert.equal(billingPlanLabel({ plan: "pro", usageTier: "pro", seats: null }), "Pro");
assert.equal(
  billingPlanDetailLine({
    solo: true,
    seats: 1,
    usageTierName: "Pro"
  }),
  null
);
assert.equal(
  billingPlanDetailLine({
    solo: false,
    seats: 8,
    mixLine: "Mixed (6 Pro · 1 Pro+ · 1 Max)",
    usageTierName: "Pro"
  }),
  "Mixed (6 Pro · 1 Pro+ · 1 Max)"
);
assert.equal(
  billingPlanDetailLine({
    solo: false,
    seats: 8,
    usageTierName: "Pro"
  }),
  "8 Pro seats"
);

assert.equal(billingPageSubtitle(true), "Your plan and payment.");
assert.equal(billingPageSubtitle(false), "Plan, seats, and payment.");

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
assert.match(teamAdd.body, /prorated/);
assert.match(teamAdd.body, /Unused seats/);
assert.doesNotMatch(teamAdd.body, /You currently have/);

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
assert.match(usersPageSubtitle({ free: false, solo: false }), /stay with the person/);

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
assert.equal(teamSeats.hint, "5 unused seats available to invite");

const teamFull = usersSeatsPanelCopy({
  free: false,
  solo: false,
  seats: 2,
  seatsUsed: 2,
  seatsAvailable: 0,
  atCapacity: true
});
assert.match(teamFull.hint, /Cancel an unused invite/);
assert.match(teamFull.hint, /keep their seat if deactivated/);
assert.match(teamFull.hint, /Reactivate lets them sign in again/);

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
assert.match(usersInviteDisabledTitle(false), /named seats are occupied/);

assert.match(usersRepoAccessHint({ solo: true, perUserAccess: false }), /Your Deep-Indexed repos/);
assert.match(usersRepoAccessHint({ solo: false, perUserAccess: false }), /Every team member/);
assert.match(usersRepoAccessHint({ solo: true, perUserAccess: true }), /Assign repos/);

assert.equal(seatMixLine("Mixed (8 Pro · 2 Max)"), "Mixed (8 Pro · 2 Max)");
assert.equal(seatMixLine("  "), null);
assert.equal(
  convertSeatPreview("Pro", "Max", 25, 100),
  "Convert this person's seat from Pro to Max (+$75/mo, charged to the card on file now)."
);
assert.match(convertSeatPreview("Pro", "Pro+"), /charged to the card on file now/);
assert.doesNotMatch(convertSeatPreview("Pro", "Pro+"), /\$/);
assert.doesNotMatch(convertSeatPreview("Pro", "Max", 25, 100), /Does not move/);

const modal = convertSeatModalCopy({
  fromName: "Pro",
  toName: "Pro+",
  fromUsd: 25,
  toUsd: 60,
  memberEmail: "alice@example.com"
});
assert.equal(modal.title, "Convert this seat");
assert.equal(modal.confirmLabel, "Convert");
assert.equal(modal.cancelLabel, "Cancel");
assert.equal(
  modal.body,
  "Convert alice@example.com's seat from Pro to Pro+ (+$35/mo, charged to the card on file now)."
);

const processing = seatConvertProcessingCopy({ fromName: "Pro", toName: "Pro+" });
assert.equal(processing.title, "Confirming this upgrade");
assert.match(processing.body, /Charging the card on file for Pro\+/);
const upgraded = seatConvertSuccessCopy("Max");
assert.equal(upgraded.title, "This seat is now Max");
const failed = seatConvertErrorCopy("Pro", "The card on file was declined.");
assert.equal(failed.title, "Upgrade didn't go through");
assert.match(failed.stay, /still Pro/);

const notice = upgradeRequestNoticeCopy({
  memberEmail: "alex@acme.com",
  toName: "Pro+",
  otherPendingCount: 0
});
assert.equal(notice.heading, "Upgrade request");
assert.equal(notice.body, "alex@acme.com asked to convert their seat to Pro+.");

const noticeMany = upgradeRequestNoticeCopy({
  memberEmail: "alex@acme.com",
  toName: "Max",
  otherPendingCount: 2
});
assert.equal(noticeMany.heading, "Upgrade requests");
assert.match(noticeMany.body, /2 more requests are still open/);

assert.deepEqual(SEAT_PRICES_USD, { pro: 25, pro_plus: 60, max: 100 });
assert.equal(seatPriceLabel("pro"), "$25/seat/mo");
assert.equal(seatPriceLabel("pro_plus"), "$60/seat/mo");
assert.equal(seatPriceLabel("max"), "$100/seat/mo");
assert.deepEqual(billingSeatBreakdown(undefined), []);
assert.deepEqual(billingSeatBreakdown({ pro: 6, pro_plus: 0, max: 2 }), [
  { tier: "pro", name: "Pro", count: 6, priceUsd: 25 },
  { tier: "max", name: "Max", count: 2, priceUsd: 100 }
]);

assert.deepEqual(billingStatusDisplay("active"), { label: "Active", tone: "connected" });
assert.equal(billingStatusDisplay("incomplete").label, "Payment incomplete");
assert.equal(billingStatusDisplay("incomplete").tone, "reconnect");
assert.match(billingStatusDisplay("incomplete").hint ?? "", /not confirmed payment/);
assert.equal(billingStatusDisplay("past_due").label, "Past due");
assert.equal(billingStatusDisplay("manual").label, "Managed with Coop");
assert.equal(billingStatusDisplay("trialing").label, "Trial");

console.log("billingCopy: 1/1 tests passed");
