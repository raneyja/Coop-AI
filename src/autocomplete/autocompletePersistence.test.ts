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

test("package.json defaults autocomplete to enabled", () => {
  const setting = packageJson.contributes?.configuration?.properties?.["coopAI.autocomplete.enabled"];
  assert.equal(setting?.default, true, "coopAI.autocomplete.enabled default must stay true");
});

test("readConfiguration falls back to autocomplete enabled when unset", () => {
  assert.equal(readConfiguration().autocompleteEnabled, true);
});

test("registerAutocomplete resolves update target before persisting enabled", () => {
  const source = readRepoFile("src/autocomplete/registerAutocomplete.ts");
  assert.match(source, /resolveAutocompleteEnabledUpdateTarget/);
  assert.match(source, /await config\.update\("enabled", enabled, updateTarget\)/);
});

test("index notifier routes toggles through setAutocompleteEnabled command", () => {
  const source = readRepoFile("src/autocomplete/coopAutocompleteProvider.ts");
  assert.match(source, /coopAI\.setAutocompleteEnabled/);
});

console.log(`\nautocompletePersistence: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
