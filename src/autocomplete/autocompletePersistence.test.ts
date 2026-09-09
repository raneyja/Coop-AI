/**
 * Regression guards for autocomplete on/off persistence.
 */
import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../../package.json";
import { readConfiguration } from "../chat/SecureApiClient";
import { resetMockConfiguration } from "./test/vscodeMockSetup";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

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

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

test("package.json defaults autocomplete to disabled", () => {
  const setting = packageJson.contributes?.configuration?.properties?.["coopAI.autocomplete.enabled"];
  assert.equal(setting?.default, false, "coopAI.autocomplete.enabled default must stay false");
});

test("readConfiguration falls back to autocomplete disabled when unset", () => {
  assert.equal(readConfiguration().autocompleteEnabled, false);
});

test("registerAutocomplete persists enabled at Global scope", () => {
  const source = readRepoFile("src/autocomplete/registerAutocomplete.ts");
  assert.match(source, /clearAutocompleteWorkspaceOverrides/);
  assert.match(source, /ConfigurationTarget\.Global/);
  assert.match(source, /await config\.update\("enabled", enabled, vscode\.ConfigurationTarget\.Global\)/);
});

test("index notifier does not toggle autocomplete from Deep-Index readiness", () => {
  const source = readRepoFile("src/autocomplete/coopAutocompleteProvider.ts");
  assert.doesNotMatch(source, /coopAI\.setAutocompleteEnabled/);
  assert.doesNotMatch(source, /ConfigurationTarget\.Workspace/);
});

test("extension does not force-enable autocomplete on startup", () => {
  const source = readRepoFile("src/extension.ts");
  assert.match(source, /clearAutocompleteWorkspaceOverrides/);
  assert.doesNotMatch(source, /restoreAutocompleteUnlessUserOptedOut/);
});

test("package.json does not steal Jump to Bracket for autocomplete trigger", () => {
  const keybindings = packageJson.contributes?.keybindings ?? [];
  const trigger = keybindings.find((binding: { command?: string }) => binding.command === "coopAI.triggerAutocomplete");
  assert.equal(trigger, undefined);
});

console.log(`\nautocompletePersistence: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
