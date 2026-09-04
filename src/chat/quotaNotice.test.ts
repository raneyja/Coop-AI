import assert from "node:assert/strict";
import {
  buildQuotaExceededUpgradeUrl,
  formatFreeQuotaCountdown,
  formatFreeQuotaResumeCopy,
  formatFreeQuotaResumeParts,
  formatPaidUsageResetCopy,
  formatPaidUsageResetParts,
  formatQuotaRetryClock,
  isFreeQuotaExhausted,
  isPaidQuotaPool,
  isPaidUsageExhausted,
  PAID_USAGE_EXHAUSTED_COPY
} from "./quotaNotice";
import { buildPaidCapMessage } from "../server/planQuota";

const resetsAt = "2026-07-01T21:37:00.000Z";

assert.equal(
  formatQuotaRetryClock(resetsAt, "America/Los_Angeles"),
  new Date(resetsAt).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles"
  })
);

assert.equal(buildQuotaExceededUpgradeUrl("https://admin.coop-ai.dev/"), "https://admin.coop-ai.dev/billing");
assert.equal(buildQuotaExceededUpgradeUrl(undefined), "https://coop-ai.dev/pricing");

assert.equal(isFreeQuotaExhausted({ remainingTokens: 0 }), true);
assert.equal(isFreeQuotaExhausted({ remainingTokens: 500 }), false);
assert.equal(isFreeQuotaExhausted({ usedTokens: 80_000, limitTokens: 80_000 }), true);
assert.equal(isFreeQuotaExhausted({ usedTokens: 56_287, limitTokens: 80_000 }), false);
assert.equal(isFreeQuotaExhausted({ remainingCredits: 0 }), true);

assert.equal(isPaidQuotaPool("paid"), true);
assert.equal(isPaidQuotaPool("auto"), true);
assert.equal(isPaidQuotaPool("frontier"), true);
assert.equal(isPaidQuotaPool("free"), false);

assert.equal(isPaidUsageExhausted({ remainingCents: 0 }), true);
assert.equal(isPaidUsageExhausted({ remainingCents: 10 }), false);
assert.equal(
  isPaidUsageExhausted({
    remainingCents: 0,
    auto: { remainingCents: 10 },
    frontier: { remainingCents: 0 }
  }),
  true
);
assert.equal(
  isPaidUsageExhausted({ auto: { remainingCents: 10 }, frontier: { remainingCents: 0 } }),
  false
);
assert.equal(PAID_USAGE_EXHAUSTED_COPY.includes("unlimited"), false);
assert.match(buildPaidCapMessage("pro_plus"), /Upgrade to Pro\+/);
assert.match(buildPaidCapMessage(undefined), /Enterprise/);

const periodEnd = "2026-09-06T17:00:00.000Z";
const resetDateLabel = new Date(periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric" });
assert.equal(
  formatPaidUsageResetCopy(periodEnd, new Date("2026-09-03T17:00:00.000Z")),
  `Usage limits reset on ${resetDateLabel} (3 days left)`
);
assert.equal(
  formatPaidUsageResetCopy(periodEnd, new Date("2026-09-05T17:00:00.000Z")),
  `Usage limits reset on ${resetDateLabel} (1 day left)`
);
assert.equal(
  formatPaidUsageResetCopy(periodEnd, new Date("2026-09-06T17:00:00.000Z")),
  `Usage limits reset on ${resetDateLabel} (today)`
);
assert.equal(formatPaidUsageResetCopy(undefined), null);
assert.equal(formatPaidUsageResetCopy("not-a-date"), null);
assert.deepEqual(formatPaidUsageResetParts(periodEnd, new Date("2026-09-03T17:00:00.000Z")), {
  dateLabel: resetDateLabel,
  countdown: "3 days left"
});
assert.equal(formatPaidUsageResetParts(undefined), null);
assert.equal(formatPaidUsageResetParts("not-a-date"), null);

assert.equal(formatFreeQuotaCountdown(0), "available now");
assert.equal(formatFreeQuotaCountdown(-1_000), "available now");
assert.equal(formatFreeQuotaCountdown(45_000), "less than a minute");
assert.equal(formatFreeQuotaCountdown(60_000), "1 minute left");
assert.equal(formatFreeQuotaCountdown(12 * 60_000), "12 minutes left");
assert.equal(formatFreeQuotaCountdown(3_600_000), "1 hour left");
assert.equal(formatFreeQuotaCountdown(4 * 3_600_000 + 12 * 60_000), "4h 12m left");

const resumeAt = "2026-09-04T03:23:00.000Z"; // 8:23 PM PDT on Sep 3
const pauseNow = new Date("2026-09-03T22:30:00.000Z"); // 3:30 PM PDT, 4h 53m before resume
const resumeClock = new Date(resumeAt).toLocaleString(undefined, {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
  timeZone: "America/Los_Angeles"
});
const pauseClock = new Date("2026-09-03T22:23:00.000Z").toLocaleString(undefined, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles"
});
assert.deepEqual(
  formatFreeQuotaResumeParts(
    { resetsAt: resumeAt, windowHours: 5, timezone: "America/Los_Angeles" },
    pauseNow
  ),
  {
    pausedAtLabel: pauseClock,
    resumesAtLabel: resumeClock,
    countdown: "4h 53m left"
  }
);
assert.equal(
  formatFreeQuotaResumeCopy(
    { resetsAt: resumeAt, windowHours: 5, timezone: "America/Los_Angeles" },
    pauseNow
  ),
  `Paused at ${pauseClock} · resumes at ${resumeClock} (4h 53m left)`
);
assert.equal(formatFreeQuotaResumeParts({ resetsAt: undefined }), null);
assert.equal(formatFreeQuotaResumeParts({ resetsAt: "not-a-date" }), null);

const nextDayResume = "2026-09-04T08:23:00.000Z"; // 1:23 AM PDT Sep 4
const lateNow = new Date("2026-09-04T06:23:00.000Z"); // 11:23 PM PDT Sep 3
const nextDayResumeClock = new Date(nextDayResume).toLocaleString(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
  timeZone: "America/Los_Angeles"
});
const nextDayPauseClock = new Date("2026-09-04T03:23:00.000Z").toLocaleString(undefined, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Los_Angeles"
});
assert.deepEqual(
  formatFreeQuotaResumeParts(
    { resetsAt: nextDayResume, windowHours: 5, timezone: "America/Los_Angeles" },
    lateNow
  ),
  {
    pausedAtLabel: nextDayPauseClock,
    resumesAtLabel: nextDayResumeClock,
    countdown: "2 hours left"
  }
);

console.log("quotaNotice: 1/1 tests passed");
