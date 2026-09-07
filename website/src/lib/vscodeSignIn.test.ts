import assert from "node:assert/strict";
import { vscodeSignInHref } from "./vscodeSignIn";

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

test("points at the Coop VS Code URI, not the admin portal or a local API", () => {
  const href = vscodeSignInHref();
  assert.equal(href, "vscode://coop-ai.coop-ai/sign-in");
  assert.equal(href.startsWith("vscode://"), true);
  assert.equal(href.includes("admin."), false);
  assert.equal(href.includes("localhost"), false);
  assert.equal(href.includes("http"), false);
});

console.log(`\nvscodeSignIn: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
