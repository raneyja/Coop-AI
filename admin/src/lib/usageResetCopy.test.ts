import assert from "node:assert/strict";
import { formatPaidUsageResetCopy } from "./usageResetCopy";

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const periodEnd = "2026-09-06T17:00:00.000Z";
const label = dateLabel(periodEnd);

assert.equal(
  formatPaidUsageResetCopy(periodEnd, new Date("2026-09-03T17:00:00.000Z")),
  `Usage limits reset on ${label} (3 days left)`
);
assert.equal(
  formatPaidUsageResetCopy(periodEnd, new Date("2026-09-05T17:00:00.000Z")),
  `Usage limits reset on ${label} (1 day left)`
);
assert.equal(
  formatPaidUsageResetCopy(periodEnd, new Date("2026-09-06T17:00:00.000Z")),
  `Usage limits reset on ${label} (today)`
);
assert.equal(formatPaidUsageResetCopy(undefined), null);
assert.equal(formatPaidUsageResetCopy("not-a-date"), null);

console.log("usageResetCopy: 1/1 tests passed");
