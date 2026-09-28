import assert from "node:assert/strict";
import {
  alertsForCapRatio,
  alertsForPaidOrg,
  capKindForPlan,
  fillCostDays,
  inventoryListPriceEconomics,
  loadOrgCostBreakdown,
  loadOrgUsageSnapshot,
  paidPlanEconomics,
  parseOperatorCostRangeKind,
  resolveOperatorCostRange,
  splitUsageQueueItems,
  unclampedRatio,
  USAGE_NEAR_CAP_RATIO
} from "./operatorUsage";
import type { Organization } from "./orgStore";
import type { UsageTracker } from "./usageTracker";
import type { UserRecord } from "./users/userStore";

void (async () => {
assert.equal(unclampedRatio(0, 1500), 0);
assert.equal(unclampedRatio(1500, 1500), 1);
assert.equal(unclampedRatio(1800, 1500), 1.2);
assert.equal(unclampedRatio(10, 0), null);
assert.equal(unclampedRatio(10, null), null);

const onePro = inventoryListPriceEconomics({ pro: 1, pro_plus: 0, max: 0 });
assert.equal(onePro.seatRevenueCents, 2500);
assert.equal(onePro.includedCents, 1500);

const mixed = inventoryListPriceEconomics({ pro: 2, pro_plus: 1, max: 0 });
assert.equal(mixed.seatRevenueCents, 2 * 2500 + 6000);
assert.equal(mixed.includedCents, 2 * 1500 + 3750);

assert.deepEqual(alertsForCapRatio(0.79), []);
assert.deepEqual(alertsForCapRatio(USAGE_NEAR_CAP_RATIO), ["near_cap"]);
assert.deepEqual(alertsForCapRatio(1), ["at_cap"]);
assert.deepEqual(alertsForCapRatio(1.2), ["at_cap"]);

assert.deepEqual(
  alertsForPaidOrg({ usedRatio: 0.5, usedCents: 400, seatRevenueCents: 2500 }),
  []
);
assert.deepEqual(
  alertsForPaidOrg({ usedRatio: 1.2, usedCents: 2600, seatRevenueCents: 2500 }),
  ["at_cap", "unprofitable"]
);
assert.deepEqual(
  alertsForPaidOrg({ usedRatio: 0.9, usedCents: 900, seatRevenueCents: 0 }),
  ["near_cap"]
);

assert.equal(capKindForPlan("pro"), "paid_included");
assert.equal(capKindForPlan("free"), "free_credits");
assert.equal(capKindForPlan("enterprise"), "unlimited");

const enterpriseEconomics = paidPlanEconomics("enterprise", { seatCount: 25, billingStatus: "active" }, []);
assert.equal(enterpriseEconomics.seatRevenueCents, null);
assert.equal(enterpriseEconomics.includedCents, null);

const queue = splitUsageQueueItems({
  orgId: "org-1",
  orgName: "Raney Apps",
  plan: "pro",
  summary: {
    capKind: "paid_included",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-09-01T00:00:00.000Z",
    usedCents: 1400,
    includedCents: 1500,
    usedRatio: 1400 / 1500,
    seatRevenueCents: 2500,
    marginCents: 1100,
    alerts: ["near_cap"]
  },
  users: [
    { email: "jon@coop-ai.dev", alerts: ["at_cap"], usedRatio: 1.05 },
    { email: "ok@coop-ai.dev", alerts: [], usedRatio: 0.1 }
  ]
});
assert.equal(queue.usageNearCap.length, 1);
assert.equal(queue.usageNearCap[0]?.trigger, "org");
assert.equal(queue.usageAtCap.length, 1);
assert.equal(queue.usageAtCap[0]?.userEmail, "jon@coop-ai.dev");
assert.equal(queue.unprofitable.length, 0);

const org: Organization = {
  id: "org-pro",
  name: "Pro Co",
  plan: "pro",
  repoAccessMode: "all_indexed",
  createdAt: new Date("2026-06-14T00:00:00.000Z")
};
const users: UserRecord[] = [
  {
    id: "user-1",
    orgId: "org-pro",
    email: "a@example.com",
    role: "admin",
    createdAt: new Date("2026-06-14T00:00:00.000Z"),
    usageTier: "pro"
  }
];

function mockTracker(autoCents: number, frontierCents: number): UsageTracker {
  return {
    canRead: () => true,
    sumUsdCentsForOrg: async (_orgId: string, _range: unknown, _types: string[], bucket: string) =>
      bucket === "auto" ? autoCents : frontierCents,
    eventsByType: async () => [
      { eventType: "chat.message", count: 9 },
      { eventType: "quick_action.trace_decision", count: 3 }
    ]
  } as unknown as UsageTracker;
}

const near = await loadOrgUsageSnapshot({
  org,
  billing: {
    seatCount: 1,
    billingStatus: "active",
    usageTier: "pro",
    seatInventory: { pro: 1, pro_plus: 0, max: 0 }
  },
  users,
  usageTracker: mockTracker(1200, 0),
  now: new Date("2026-09-10T12:00:00.000Z")
});
assert.equal(near.capKind, "paid_included");
assert.equal(near.usedCents, 1200);
assert.equal(near.includedCents, 1500);
assert.equal(near.seatRevenueCents, 2500);
assert.equal(near.marginCents, 1300);
assert.ok((near.usedRatio ?? 0) >= 0.8);
assert.deepEqual(near.alerts, ["near_cap"]);
assert.equal(near.productMix.chat, 9);
assert.equal(near.productMix.quickActions, 3);

const over = await loadOrgUsageSnapshot({
  org,
  billing: {
    seatCount: 1,
    billingStatus: "active",
    usageTier: "pro",
    seatInventory: { pro: 1, pro_plus: 0, max: 0 }
  },
  users,
  usageTracker: mockTracker(2000, 700),
  now: new Date("2026-09-10T12:00:00.000Z"),
  includeMix: false
});
assert.equal(over.usedCents, 2700);
assert.deepEqual(over.alerts, ["at_cap", "unprofitable"]);
assert.equal(over.productMix.chat, 0);

const enterprise = await loadOrgUsageSnapshot({
  org: { ...org, id: "org-ent", plan: "enterprise" },
  billing: { seatCount: 25, billingStatus: "active" },
  users: [],
  usageTracker: mockTracker(5000, 0),
  now: new Date("2026-09-10T12:00:00.000Z"),
  includeMix: false
});
assert.equal(enterprise.capKind, "unlimited");
assert.equal(enterprise.usedCents, 5000);
assert.equal(enterprise.includedCents, null);
assert.equal(enterprise.seatRevenueCents, null);
assert.deepEqual(enterprise.alerts, []);

assert.equal(parseOperatorCostRangeKind("7d"), "7d");
assert.equal(parseOperatorCostRangeKind("week"), "7d");
assert.equal(parseOperatorCostRangeKind("month"), "month");
assert.equal(parseOperatorCostRangeKind(undefined), "30d");

const weekRange = resolveOperatorCostRange("7d", new Date("2026-09-28T12:00:00.000Z"));
assert.equal(weekRange.label, "Last 7 days");
assert.equal(weekRange.from.toISOString(), "2026-09-21T12:00:00.000Z");

const monthRange = resolveOperatorCostRange("month", new Date("2026-09-28T12:00:00.000Z"));
assert.equal(monthRange.from.toISOString(), "2026-09-01T00:00:00.000Z");

const filled = fillCostDays(
  [{ day: "2026-09-22", autoCents: 40, frontierCents: 10 }],
  new Date("2026-09-21T12:00:00.000Z"),
  new Date("2026-09-24T12:00:00.000Z")
);
assert.equal(filled.length, 4);
assert.equal(filled[0]?.day, "2026-09-21");
assert.equal(filled[0]?.usedCents, 0);
assert.equal(filled[1]?.usedCents, 50);
assert.equal(filled[3]?.day, "2026-09-24");

const costTracker = {
  canRead: () => true,
  sumUsdCentsByDay: async () => [
    { day: "2026-09-22", autoCents: 100, frontierCents: 25 },
    { day: "2026-09-23", autoCents: 50, frontierCents: 0 }
  ],
  eventsByType: async () => [{ eventType: "chat.message", count: 2 }],
  eventsByTypeForPrincipals: async () => [{ eventType: "chat.message", count: 1 }],
  sumUsdCentsByUserIds: async () =>
    new Map([["user-1", { autoCents: 150, frontierCents: 25 }]])
} as unknown as UsageTracker;

const cost = await loadOrgCostBreakdown({
  orgId: "org-pro",
  users,
  usageTracker: costTracker,
  rangeKind: "7d",
  now: new Date("2026-09-28T12:00:00.000Z")
});
assert.equal(cost.totals.usedCents, 175);
assert.equal(cost.totals.autoCents, 150);
assert.equal(cost.productMix.chat, 2);
assert.equal(cost.byUser[0]?.email, "a@example.com");
assert.ok(cost.days.length >= 7);

console.log("operatorUsage.test.ts: ok");
})();
