import assert from "node:assert/strict";
import { indexPatchFileContent, lookupPatchFileContent } from "./patchFileContents";

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

test("lookupPatchFileContent matches a repo-relative alias of the same file", () => {
  const files: Record<string, string> = {};
  indexPatchFileContent("plane/apps/api/plane/db/models/state.py", "IN PROGRESS BODY", files);
  assert.equal(
    lookupPatchFileContent("apps/api/plane/db/models/state.py", files),
    "IN PROGRESS BODY"
  );
});

test("lookupPatchFileContent ignores empty bodies", () => {
  assert.equal(lookupPatchFileContent("src/foo.ts", { "src/foo.ts": "" }), undefined);
});

console.log(`\npatchFileContents: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
