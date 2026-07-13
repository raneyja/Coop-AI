import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  SUPPRESS_SUGGEST_WIDGET_SETTING,
  syncSuggestWidgetCoexistenceWithCoopAutocomplete
} from "./suggestWidgetCoexistence";
import {
  clearMockConfigUpdates,
  createMockExtensionContext,
  getMockConfigUpdates,
  resetMockConfiguration,
  setMockConfiguration
} from "./test/vscodeMockSetup";

let passed = 0;
let failed = 0;

async function asyncTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    resetMockConfiguration();
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

async function runAsyncTests(): Promise<void> {
  await asyncTest(
    "syncSuggestWidgetCoexistenceWithCoopAutocomplete enables suppressSuggestions when Coop autocomplete is on",
    async () => {
      const context = createMockExtensionContext() as vscode.ExtensionContext;
      await syncSuggestWidgetCoexistenceWithCoopAutocomplete(context, true);

      const updates = getMockConfigUpdates();
      assert.equal(updates.length, 1);
      assert.equal(updates[0]?.key, SUPPRESS_SUGGEST_WIDGET_SETTING);
      assert.equal(updates[0]?.value, true);
      assert.equal(updates[0]?.target, vscode.ConfigurationTarget.Global);
    }
  );

  await asyncTest(
    "syncSuggestWidgetCoexistenceWithCoopAutocomplete is a no-op when already suppressing",
    async () => {
      setMockConfiguration(undefined, SUPPRESS_SUGGEST_WIDGET_SETTING, true);
      const context = createMockExtensionContext() as vscode.ExtensionContext;
      await syncSuggestWidgetCoexistenceWithCoopAutocomplete(context, true);
      assert.equal(getMockConfigUpdates().length, 0);
    }
  );

  await asyncTest(
    "syncSuggestWidgetCoexistenceWithCoopAutocomplete restores prior value when Coop autocomplete turns off",
    async () => {
      setMockConfiguration(undefined, SUPPRESS_SUGGEST_WIDGET_SETTING, false);
      const context = createMockExtensionContext() as vscode.ExtensionContext;

      await syncSuggestWidgetCoexistenceWithCoopAutocomplete(context, true);
      clearMockConfigUpdates();
      setMockConfiguration(undefined, SUPPRESS_SUGGEST_WIDGET_SETTING, true);

      await syncSuggestWidgetCoexistenceWithCoopAutocomplete(context, false);

      const updates = getMockConfigUpdates();
      assert.equal(updates.length, 1);
      assert.equal(updates[0]?.key, SUPPRESS_SUGGEST_WIDGET_SETTING);
      assert.equal(updates[0]?.value, false);
    }
  );

  await asyncTest(
    "syncSuggestWidgetCoexistenceWithCoopAutocomplete does nothing on disable when never managed",
    async () => {
      const context = createMockExtensionContext() as vscode.ExtensionContext;
      await syncSuggestWidgetCoexistenceWithCoopAutocomplete(context, false);
      assert.equal(getMockConfigUpdates().length, 0);
    }
  );
}

void runAsyncTests().then(() => {
  console.log(`\nsuggestWidgetCoexistence: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
});
