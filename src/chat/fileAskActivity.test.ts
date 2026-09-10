import assert from "node:assert/strict";
import { fileAskActivityMessages } from "./fileAskActivity";

const ASK =
  "Give me a tl;dr of this file? What does it do, what other files rely on it, and who created it / when?";

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

test("seeds read + rely-on + created for the file chip ask", () => {
  const messages = fileAskActivityMessages(ASK, "src/server/authMiddleware.ts");
  assert.deepEqual(messages, [
    "Read `src/server/authMiddleware.ts`",
    "Find files that rely on `src/server/authMiddleware.ts`",
    "Look up who created `src/server/authMiddleware.ts`"
  ]);
});

test("explain-only is just a Read row", () => {
  assert.deepEqual(fileAskActivityMessages("What does this file do?", "src/a.ts"), [
    "Read `src/a.ts`"
  ]);
});

test("no file and no extra asks is empty", () => {
  assert.deepEqual(fileAskActivityMessages("hello"), []);
});

console.log(`\nfileAskActivity: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
