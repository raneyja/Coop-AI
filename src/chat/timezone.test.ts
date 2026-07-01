import assert from "node:assert/strict";
import {
  DEFAULT_TIMEZONE_ID,
  formatEuropeanTimezoneLabel,
  listEuropeanTimezoneOptions,
  resolveTimezone,
  resolveTimezonePreference,
  US_TIMEZONE_OPTIONS
} from "./timezone";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("resolveTimezone uses stored US value when set", () => {
  assert.equal(resolveTimezone("America/Chicago"), "America/Chicago");
});

test("resolveTimezone uses stored European value when set", () => {
  assert.equal(resolveTimezone("Europe/London"), "Europe/London");
});

test("resolveTimezone defaults to Pacific when empty", () => {
  assert.equal(resolveTimezone(""), DEFAULT_TIMEZONE_ID);
  assert.equal(resolveTimezone(undefined), DEFAULT_TIMEZONE_ID);
  assert.equal(resolveTimezone("   "), DEFAULT_TIMEZONE_ID);
});

test("resolveTimezonePreference ignores unknown values", () => {
  assert.equal(resolveTimezonePreference("Asia/Tokyo"), DEFAULT_TIMEZONE_ID);
});

test("US_TIMEZONE_OPTIONS use familiar abbreviations", () => {
  assert.deepEqual(
    US_TIMEZONE_OPTIONS.map((option) => option.label),
    ["PST", "MST", "CST", "EST", "AKST", "HST"]
  );
});

test("European timezone labels use GMT offsets with city names", () => {
  const winter = new Date("2026-01-15T12:00:00Z");
  assert.match(formatEuropeanTimezoneLabel("Europe/London", "London", winter), /^GMT — London$|^GMT\+0 — London$/);
  assert.match(formatEuropeanTimezoneLabel("Europe/Paris", "Paris", winter), /GMT\+1 — Paris/);
  const options = listEuropeanTimezoneOptions(winter);
  assert.ok(options.some((option) => option.id === "Europe/Berlin" && option.label.includes("Berlin")));
});

console.log(`\ntimezone: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
