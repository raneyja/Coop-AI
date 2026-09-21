import assert from "node:assert/strict";
import {
  isAutocompleteOnlySettingsUpdate,
  shouldRefreshSessionsOnCoopConfigChange
} from "./autocompletePreferenceSync";

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

test("isAutocompleteOnlySettingsUpdate accepts a lone boolean toggle", () => {
  assert.equal(isAutocompleteOnlySettingsUpdate({ autocompleteEnabled: false }), true);
  assert.equal(isAutocompleteOnlySettingsUpdate({ autocompleteEnabled: true }), true);
});

test("isAutocompleteOnlySettingsUpdate rejects mixed or empty payloads", () => {
  assert.equal(isAutocompleteOnlySettingsUpdate({}), false);
  assert.equal(isAutocompleteOnlySettingsUpdate({ autocompleteEnabled: true, timezone: "UTC" }), false);
  assert.equal(isAutocompleteOnlySettingsUpdate({ timezone: "UTC" }), false);
});

test("shouldRefreshSessionsOnCoopConfigChange skips autocomplete-only toggles", () => {
  assert.equal(
    shouldRefreshSessionsOnCoopConfigChange((section) =>
      section === "coopAI" || section === "coopAI.autocomplete.enabled"
    ),
    false
  );
});

test("shouldRefreshSessionsOnCoopConfigChange still refreshes other Coop settings", () => {
  assert.equal(
    shouldRefreshSessionsOnCoopConfigChange((section) => section === "coopAI" || section === "coopAI.timezone"),
    true
  );
  assert.equal(
    shouldRefreshSessionsOnCoopConfigChange(
      (section) =>
        section === "coopAI" ||
        section === "coopAI.autocomplete.enabled" ||
        section === "coopAI.defaultModel"
    ),
    true
  );
  assert.equal(shouldRefreshSessionsOnCoopConfigChange(() => false), false);
});

console.log(`\nautocompletePreferenceSync: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
