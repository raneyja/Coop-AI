import assert from "node:assert/strict";
import type { Pool } from "pg";
import { UsageTracker } from "./usageTracker";
import { fillCostDays, resolveOperatorCostRange, parseOperatorCostRangeKind, loadOrgCostBreakdown, loadOrgUsageSnapshot, loadUserUsageSummaries } from "./operatorUsage";
import { StripeService } from "./billing/stripeService";
import { applyOperatorUsageCredit } from "./operatorUsageCredit";
import type { Organization } from "./orgStore";
import type { UserRecord } from "./users/userStore";
import type { UsageEventEntry } from "./usageTracker";
import type { BillingConfig } from "./billing/billingConfig";

void (async () => {
  const from = new Date("2026-09-01T00:00:00Z");
  const to = new Date("2026-10-01T00:00:00Z");
  const tracker = new UsageTracker({ query: async (sql: string, params: unknown[]) => {
    assert.ok(sql.includes("::date::text AS day"));
    assert.equal(params[0], "org-1");
    return { rows: [
      { day: new Date("2026-09-22T00:00:00Z"), bucket: "auto", total: 138 },
      { day: "2026-09-22", bucket: "frontier", total: 1179 }
    ] };
  } } as unknown as Pool);
  const sparse = await tracker.sumUsdCentsByDay("org-1", { from, to }, ["chat.message"]);
  const days = fillCostDays(sparse, from, to);
  assert.equal(days.reduce((sum, day) => sum + day.usedCents, 0), 1317);
  assert.equal(days.find(day => day.day === "2026-09-22")?.usedCents, 1317);
  assert.equal(parseOperatorCostRangeKind("90d"), "90d");
  assert.equal(resolveOperatorCostRange("90d", to).from.toISOString(), "2026-07-03T00:00:00.000Z");

  // A real operator reset changes allowance meters, never incurred model spend.
  const now = new Date("2026-09-28T12:00:00Z");
  const org = { id: "org-1", name: "Test", plan: "pro", createdAt: from } as Organization;
  const user = { id: "user-1", email: "test@example.com", role: "owner", usageTier: "pro" } as UserRecord;
  const ledger: UsageEventEntry[] = [
    { orgId: org.id, userId: user.id, principal: user.id, eventType: "chat.message", metadata: { usdCents: 138, bucket: "auto" } },
    { orgId: org.id, userId: user.id, principal: user.id, eventType: "chat.message", metadata: { usdCents: 1179, bucket: "frontier" } }
  ];
  const sum = (types: string[], bucket: string) => ledger.filter(event => types.includes(event.eventType) && event.metadata?.bucket === bucket)
    .reduce((total, event) => total + Number(event.metadata?.usdCents ?? 0), 0);
  const ledgerTracker = {
    canRead: () => true,
    record: async (entry: UsageEventEntry) => { ledger.push(entry); },
    eventsByType: async () => [], eventsByTypeForPrincipals: async () => [], lastActiveAtByPrincipal: async () => [],
    sumUsdCentsForOrg: async (_org: string, _range: unknown, types: string[], bucket: string) => sum(types, bucket),
    sumUsdCentsByUserIds: async (_org: string, _range: unknown, types: string[]) => new Map([[user.id, { autoCents: sum(types, "auto"), frontierCents: sum(types, "frontier") }]]),
    sumUsdCentsByDay: async (_org: string, _range: unknown, types: string[]) => [{ day: "2026-09-22", autoCents: sum(types, "auto"), frontierCents: sum(types, "frontier") }]
  } as unknown as UsageTracker;
  const input = { org, users: [user], usageTracker: ledgerTracker, now };
  const before = await loadOrgCostBreakdown({ ...input, orgId: org.id });
  const reset = await applyOperatorUsageCredit({ ...input, user, targetUsedRatio: 0, reason: "Dogfood testing", operatorEmail: "ops@example.com" });
  assert.equal(reset.ok, true);
  if (!reset.ok) throw new Error("Reset failed");
  assert.equal(reset.afterUsedRatio, 0);
  const after = await loadOrgCostBreakdown({ ...input, orgId: org.id });
  assert.deepEqual(after.totals, before.totals);
  assert.equal(after.totals.usedCents, 1317);
  assert.equal(after.byUser[0]?.usedCents, 1317);
  assert.deepEqual(after.days, before.days);
  const orgSnapshot = await loadOrgUsageSnapshot(input);
  assert.equal(orgSnapshot.usedCents, 0);
  assert.equal(orgSnapshot.usedRatio, 0);
  assert.equal(orgSnapshot.costCents, 1317);
  assert.equal(orgSnapshot.marginCents, 2500 - 1317);
  const userSummary = (await loadUserUsageSummaries(input)).get(user.id);
  assert.equal(userSummary?.usedCents, 0);
  assert.equal(userSummary?.costCents, 1317);
  // New consumption after a reset adds to real costs and starts using allowance again.
  ledger.push({ ...ledger[0], metadata: { usdCents: 100, bucket: "auto" } });
  assert.equal((await loadOrgCostBreakdown({ ...input, orgId: org.id })).totals.usedCents, 1417);
  assert.equal((await loadOrgUsageSnapshot(input)).usedCents, 100);

  const originalFetch = globalThis.fetch;
  const stripe = new StripeService({ stripeSecretKey: "test" } as BillingConfig);
  let calls = 0;
  try {
    globalThis.fetch = async (url) => {
      const query = new URL(String(url)).searchParams;
      assert.equal(query.get("created[gte]"), String(from.getTime() / 1000));
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ has_more: true, data: [
        { id: "in_1", customer: "cus_1", currency: "usd", status: "paid", total: 2500, post_payment_credit_notes_amount: 100 },
        { id: "in_2", customer: "cus_other", currency: "usd", status: "paid", total: 99999 },
        { id: "in_3", customer: "cus_2", currency: "usd", status: "draft", total: 2500 }
      ] }));
      assert.equal(query.get("starting_after"), "in_3");
      return new Response(JSON.stringify({ has_more: false, data: [
        { id: "in_4", customer: "cus_2", currency: "usd", status: "open", total: 5000 },
        { id: "in_5", customer: "cus_1", currency: "usd", status: "void", total: 2500 }
      ] }));
    };
    assert.equal(await stripe.billedCentsInRange(from, to, ["cus_1", "cus_2"]), 7400);
    assert.equal(calls, 2);
    globalThis.fetch = async () => new Response("{}", { status: 503 });
    await assert.rejects(stripe.billedCentsInRange(from, to, ["cus_1"]), /unavailable/);
    globalThis.fetch = async () => new Response(JSON.stringify({ has_more: false, data: [
      { id: "in_6", customer: "cus_1", currency: "eur", status: "paid", total: 5000 }
    ] }));
    await assert.rejects(stripe.billedCentsInRange(from, to, ["cus_1"]), /Non-USD/);
  } finally { globalThis.fetch = originalFetch; }
  console.log("operatorFinancials.test.ts: ok");
})();
