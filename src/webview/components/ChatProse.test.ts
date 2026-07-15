import assert from "node:assert/strict";
import { parseChatProse } from "../lib/chatProseParser";
import { shouldHidePatchBlock } from "./ChatProse";

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

test("hides the File: header paragraph that precedes a patch block", () => {
  const content = [
    "File: `src/example.ts`",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "foo",
    "=======",
    "bar",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const doc = parseChatProse(content);
  const hidden = doc.blocks.map(shouldHidePatchBlock);
  assert.deepEqual(hidden, [true, true], "both the File: paragraph and the patch fence should be hidden");
});

test("hides File: headers for multiple files in the same patch response", () => {
  const content = [
    "File: `src/a.ts`",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "a",
    "=======",
    "b",
    ">>>>>>> REPLACE",
    "```",
    "",
    "File: `src/b.ts`",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "c",
    "=======",
    "d",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const doc = parseChatProse(content);
  const hidden = doc.blocks.map(shouldHidePatchBlock);
  assert.deepEqual(hidden, [true, true, true, true]);
});

test("does not hide ordinary paragraphs mentioning a file", () => {
  const content = "The bug is in `src/example.ts` near the top of the file.";
  const doc = parseChatProse(content);
  const hidden = doc.blocks.map(shouldHidePatchBlock);
  assert.deepEqual(hidden, [false]);
});

console.log(`\nChatProse: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
