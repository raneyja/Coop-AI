import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import { resetMockConfiguration, setMockConfiguration } from "./test/vscodeMockSetup";
import {
  isAutocompleteGloballyEnabled,
  readAutocompleteSettings
} from "./autocompleteConfig";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    resetMockConfiguration();
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("readAutocompleteSettings returns package defaults when unset", () => {
  const settings = readAutocompleteSettings();
  assert.equal(settings.enabled, false);
  assert.equal(settings.trigger, "auto");
  assert.equal(settings.model, "haiku");
  assert.equal(settings.requestTimeoutMs, 400);
  assert.equal(settings.useFim, true);
  assert.equal(settings.useGraphContext, false);
});

test("readAutocompleteSettings reads coopAI.autocomplete overrides", () => {
  setMockConfiguration("coopAI.autocomplete", "enabled", true);
  setMockConfiguration("coopAI.autocomplete", "model", "gpt35");
  setMockConfiguration("coopAI.autocomplete", "customModel", "gpt-4o");
  setMockConfiguration("coopAI.autocomplete", "useGraphContext", true);
  setMockConfiguration("coopAI.autocomplete", "requestTimeoutMs", 800);

  const settings = readAutocompleteSettings();
  assert.equal(settings.enabled, true);
  assert.equal(settings.model, "gpt35");
  assert.equal(settings.customModel, "gpt-4o");
  assert.equal(settings.useGraphContext, true);
  assert.equal(settings.requestTimeoutMs, 800);
});

test("isAutocompleteGloballyEnabled reflects enabled flag", () => {
  assert.equal(isAutocompleteGloballyEnabled(), false);
  setMockConfiguration("coopAI.autocomplete", "enabled", true);
  assert.equal(isAutocompleteGloballyEnabled(), true);
});

console.log(`\nautocompleteConfig: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
