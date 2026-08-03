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
  assert.ok(hidden.length >= 2);
  assert.ok(hidden.every(Boolean), "File: paragraph and patch fence/citation should be hidden");
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
  assert.ok(hidden.every(Boolean), "all File: and patch blocks should hide");
});

test("hides patch content recovered as a code-citation", () => {
  const content = [
    "File: `packages/lib/server-utils/public-api/get-api-token-by-token.ts`",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "const apiToken = await prisma.apiToken.findFirst({",
    "=======",
    "const apiToken = await prisma.apiToken.findFirst({",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const doc = parseChatProse(content);
  assert.ok(doc.blocks.some((block) => block.type === "code-citation"));
  assert.ok(doc.blocks.every(shouldHidePatchBlock));
});

test("does not hide ordinary paragraphs mentioning a file", () => {
  const content = "The bug is in `src/example.ts` near the top of the file.";
  const doc = parseChatProse(content);
  const hidden = doc.blocks.map(shouldHidePatchBlock);
  assert.deepEqual(hidden, [false]);
});

test("hides unfenced SEARCH/REPLACE paragraphs when patch card suppresses markdown", () => {
  const content = [
    "File: `src/example.ts`",
    "",
    "<<<<<<< SEARCH",
    "foo",
    "=======",
    "bar",
    ">>>>>>> REPLACE"
  ].join("\n");
  const doc = parseChatProse(content);
  const hidden = doc.blocks.map(shouldHidePatchBlock);
  assert.ok(hidden.every(Boolean), "File header and unfenced patch body should hide");
});

console.log(`\nChatProse: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
