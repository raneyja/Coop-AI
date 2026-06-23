import assert from "node:assert/strict";
import { combineStalenessLabels, formatEvidenceStaleness } from "./evidenceStaleness";

const now = new Date("2026-06-17T12:00:00Z");
const twoYearsAgo = new Date("2024-01-15T12:00:00Z");

const stale = formatEvidenceStaleness({
  eventDate: twoYearsAgo,
  referenceDate: now,
  fileChangeCountSince: 18
});
assert.ok(stale.staleWarning?.includes("18"));
assert.ok(stale.ageLabel?.includes("y ago"));
assert.match(stale.staleWarning ?? "", /Evidence is from .* verify against current code/);
assert.doesNotMatch(stale.staleWarning ?? "", / ago old/);

const fresh = formatEvidenceStaleness({
  eventDate: new Date("2026-06-10T12:00:00Z"),
  referenceDate: now
});
assert.equal(fresh.staleWarning, undefined);

assert.equal(combineStalenessLabels(["2y ago", "file changed 5×"]), "2y ago · file changed 5×");

console.log("evidenceStaleness: ok");
