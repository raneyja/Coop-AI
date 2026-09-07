import assert from "node:assert/strict";
import {
  formatFreeQuotaCountdown,
  formatFreeQuotaResumeCopy,
  formatFreeQuotaResumeParts,
  formatPaidUsageResetCopy,
  formatPaidUsageResetParts,
  formatQuotaUsageSummary
} from "./usageResetCopy";

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
assert.deepEqual(formatPaidUsageResetParts(periodEnd, new Date("2026-09-03T17:00:00.000Z")), {
  dateLabel: label,
  countdown: "3 days left"
});
assert.equal(formatPaidUsageResetParts(undefined), null);
assert.equal(formatPaidUsageResetParts("not-a-date"), null);

assert.equal(
  formatQuotaUsageSummary({
    usedCredits: 12,
    limitCredits: 80,
    remainingCredits: 68,
    windowHours: 5
  }),
  "12K of 80K AI credits used - 5-hour rolling window"
);
assert.equal(
  formatQuotaUsageSummary(
    {
      usedCredits: 130,
      limitCredits: 80,
      remainingCredits: 0,
      windowHours: 5
    },
    { exhausted: true }
  ),
  "130K of 80K AI credits used"
);

assert.equal(formatFreeQuotaCountdown(0), "available now");
assert.equal(formatFreeQuotaCountdown(4 * 3_600_000 + 56 * 60_000), "4h 56m left");

const resumeAt = "2026-09-04T01:57:00.000Z";
const pauseNow = new Date("2026-09-03T21:01:00.000Z");
const resumeParts = formatFreeQuotaResumeParts({ resetsAt: resumeAt, windowHours: 5 }, pauseNow);
assert.ok(resumeParts);
assert.equal(resumeParts.countdown, "4h 56m left");
assert.match(
  formatFreeQuotaResumeCopy({ resetsAt: resumeAt, windowHours: 5 }, pauseNow) ?? "",
  /Paused at .* · resumes at .* \(4h 56m left\)/
);
assert.equal(formatFreeQuotaResumeParts({ resetsAt: undefined }), null);

console.log("usageResetCopy: 1/1 tests passed");
