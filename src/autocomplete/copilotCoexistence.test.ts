import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  COPILOT_INLINE_ENABLE_SETTING,
  detectCopilotExtensions,
  isCopilotInlineDisabled,
  isCopilotInstalled,
  syncCopilotInlineWithCoopAutocomplete
} from "./copilotCoexistence";
import {
  createMockExtensionContext,
  clearMockConfigUpdates,
  getMockConfigUpdates,
  resetMockConfiguration,
  setMockConfiguration,
  setMockExtension
} from "./test/vscodeMockSetup";

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

test("isCopilotInlineDisabled detects global false", () => {
  assert.equal(isCopilotInlineDisabled(false), true);
  assert.equal(isCopilotInlineDisabled(true), false);
  assert.equal(isCopilotInlineDisabled(undefined), false);
});

test("isCopilotInlineDisabled detects wildcard false", () => {
  assert.equal(isCopilotInlineDisabled({ "*": false }), true);
  assert.equal(isCopilotInlineDisabled({ "*": true, typescript: false }), false);
});

test("detectCopilotExtensions reports installed and active extensions", () => {
  setMockExtension("GitHub.copilot", { isActive: true });
  const detection = detectCopilotExtensions();
  assert.deepEqual(detection.installed, ["GitHub.copilot"]);
  assert.equal(detection.active, true);
  assert.equal(isCopilotInstalled(), true);
});

async function runAsyncTests(): Promise<void> {
  await asyncTest("syncCopilotInlineWithCoopAutocomplete snapshots and disables Copilot inline", async () => {
    setMockExtension("GitHub.copilot", { isActive: true });
    setMockConfiguration(undefined, COPILOT_INLINE_ENABLE_SETTING, { "*": true });

    const context = createMockExtensionContext() as vscode.ExtensionContext;
    await syncCopilotInlineWithCoopAutocomplete(context, true);

    const updates = getMockConfigUpdates();
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.key, COPILOT_INLINE_ENABLE_SETTING);
    assert.deepEqual(updates[0]?.value, { "*": false });
    assert.equal(updates[0]?.target, vscode.ConfigurationTarget.Global);
  });

  await asyncTest("syncCopilotInlineWithCoopAutocomplete restores snapshot when Coop autocomplete turns off", async () => {
    setMockExtension("GitHub.copilot", { isActive: true });
    setMockConfiguration(undefined, COPILOT_INLINE_ENABLE_SETTING, { "*": true, typescript: true });

    const context = createMockExtensionContext() as vscode.ExtensionContext;
    await syncCopilotInlineWithCoopAutocomplete(context, true);
    clearMockConfigUpdates();
    setMockConfiguration(undefined, COPILOT_INLINE_ENABLE_SETTING, { "*": false });

    await syncCopilotInlineWithCoopAutocomplete(context, false);

    const updates = getMockConfigUpdates();
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0]?.value, { "*": true, typescript: true });
  });

  await asyncTest("syncCopilotInlineWithCoopAutocomplete is a no-op when Copilot is not installed", async () => {
    const context = createMockExtensionContext() as vscode.ExtensionContext;
    await syncCopilotInlineWithCoopAutocomplete(context, true);
    assert.equal(getMockConfigUpdates().length, 0);
  });
}

void runAsyncTests().then(() => {
  console.log(`\ncopilotCoexistence: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
});
