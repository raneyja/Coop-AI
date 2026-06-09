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
  assert.equal(migrateSettingsScreen("code-hosts"), "connections");
  assert.equal(migrateSettingsScreen("integrations"), "connections");
  assert.equal(migrateSettingsScreen("identity-links"), "team");
});

test("settingsScreenParent routes provider screens to connections", () => {
  assert.equal(settingsScreenParent("code-host-github"), "connections");
  assert.equal(settingsScreenParent("integration-slack"), "connections");
});

test("settingsScreenParent routes preferences children", () => {
  assert.equal(settingsScreenParent("model"), "preferences");
  assert.equal(settingsScreenParent("prompts"), "preferences");
});

console.log(`\nsettingsScreens: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
