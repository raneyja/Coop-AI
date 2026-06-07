import assert from "node:assert/strict";
import { wantsGoogleDocsContext } from "./googleDocsContext";

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

test("wantsGoogleDocsContext matches explicit google docs questions", () => {
  assert.equal(wantsGoogleDocsContext("any google docs for this repo?"), true);
  assert.equal(wantsGoogleDocsContext("What is the auth flow?"), false);
});

const total = passed + failed;
console.log(`\ngoogleDocsContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
