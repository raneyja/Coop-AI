import assert from "node:assert/strict";
import {
  creditAmountToReachRatio,
  parseUsageCreditReason,
  parseUsageCreditTargetRatio,
  splitPaidCreditCents
} from "./operatorUsageCredit";
import { isSignedIntJson, JSONB_SIGNED_INT_REGEX, UsageTracker } from "./usageTracker";

void (async () => {
  assert.equal(parseUsageCreditTargetRatio(0), 0);
  assert.equal(parseUsageCreditTargetRatio(0.25), 0.25);
  assert.equal(parseUsageCreditTargetRatio(0.5), 0.5);
  assert.equal(parseUsageCreditTargetRatio("0.5"), 0.5);
  assert.equal(parseUsageCreditTargetRatio(0.99), undefined);
  assert.equal(parseUsageCreditTargetRatio(1), undefined);

  assert.equal(parseUsageCreditReason("Customer hit the cap in dogfood"), "Customer hit the cap in dogfood");
  assert.equal(parseUsageCreditReason("  "), undefined);
  assert.equal(parseUsageCreditReason(""), undefined);
  assert.equal(parseUsageCreditReason("x".repeat(501)), undefined);

  assert.equal(creditAmountToReachRatio(1485, 1500, 0.5), 735);
  assert.equal(creditAmountToReachRatio(1485, 1500, 0.25), 1110);
  assert.equal(creditAmountToReachRatio(1485, 1500, 0), 1485);
  assert.equal(creditAmountToReachRatio(700, 1500, 0.5), 0);
  assert.equal(creditAmountToReachRatio(80_000, 80_000, 0.5), 40_000);

  assert.deepEqual(splitPaidCreditCents(900, 100, 500), { auto: 450, frontier: 50 });
  assert.deepEqual(splitPaidCreditCents(1000, 500, 750), { auto: 500, frontier: 250 });
  assert.deepEqual(splitPaidCreditCents(1500, 0, 750), { auto: 750, frontier: 0 });
  assert.deepEqual(splitPaidCreditCents(0, 0, 100), { auto: 0, frontier: 0 });

  assert.equal(isSignedIntJson("12"), true);
  assert.equal(isSignedIntJson("-750"), true);
  assert.equal(isSignedIntJson("12.5"), false);
  assert.equal(isSignedIntJson(""), false);
  assert.equal(JSONB_SIGNED_INT_REGEX, "^-?\\d+$");
  assert.ok(new RegExp(JSONB_SIGNED_INT_REGEX).test("-40"));

  const capturedSql: string[] = [];
  const signedTracker = new UsageTracker({
    query: async (sql: string) => {
      capturedSql.push(sql);
      return { rows: [{ total: 0 }] };
    }
  } as never);
  const range = { from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-09-16T00:00:00.000Z") };
  await signedTracker.sumUsdCentsForOrg("org-1", range, ["quota.credit"], "auto");
  await signedTracker.sumTokensForOrg("org-1", range, ["quota.credit"]);
  assert.ok(capturedSql.some((sql) => sql.includes(JSONB_SIGNED_INT_REGEX)));
  assert.equal(capturedSql.some((sql) => sql.includes("'^\\\\d+$'") || sql.includes("'^\\d+$'")), false);

  console.log("operatorUsageCredit tests passed");
})();
