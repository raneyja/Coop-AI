import assert from "node:assert/strict";
import { migrateSettingsScreen, settingsScreenParent } from "./settingsScreens";

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

test("migrateSettingsScreen maps legacy hub screens", () => {
  assert.equal(migrateSettingsScreen("api"), "account");
  assert.equal(migrateSettingsScreen("code-hosts"), "tools");
  assert.equal(migrateSettingsScreen("integrations"), "tools");
  assert.equal(migrateSettingsScreen("connections"), "tools");
  assert.equal(migrateSettingsScreen("identity-links"), "team");
});

test("settingsScreenParent routes provider screens to tools", () => {
  assert.equal(settingsScreenParent("code-host-github"), "tools");
  assert.equal(settingsScreenParent("integration-slack"), "tools");
  assert.equal(settingsScreenParent("team"), "tools");
});

test("settingsScreenParent routes preferences children", () => {
  assert.equal(settingsScreenParent("model"), "preferences");
  assert.equal(settingsScreenParent("prompts"), "preferences");
});

test("settingsScreenParent routes plan and indexing to hub", () => {
  assert.equal(settingsScreenParent("plan-usage"), "hub");
  assert.equal(settingsScreenParent("indexing"), "hub");
});

test("migrateSettingsScreen accepts new screens", () => {
  assert.equal(migrateSettingsScreen("plan-usage"), "plan-usage");
  assert.equal(migrateSettingsScreen("indexing"), "indexing");
});

console.log(`\nsettingsScreens: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
