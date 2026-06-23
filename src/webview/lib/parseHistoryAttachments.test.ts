import assert from "node:assert/strict";
import {
  parseAttachmentLabel,
  parseContextLineAttachments,
  splitPlainChatHistoryBody
} from "./parseHistoryAttachments";

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

test("parseAttachmentLabel handles local workspace suffix", () => {
  const parsed = parseAttachmentLabel(".dockerignore (local workspace)");
  assert.equal(parsed.basename, ".dockerignore");
  assert.equal(parsed.isLocal, true);
});

test("splitPlainChatHistoryBody separates message and attached chips", () => {
  const split = splitPlainChatHistoryBody(
    "Does this file do anything?\nattached: .dockerignore (local workspace)"
  );
  assert.equal(split.message, "Does this file do anything?");
  assert.equal(split.attachments.length, 1);
  assert.equal(split.attachments[0]?.basename, ".dockerignore");
});

test("parseContextLineAttachments extracts attached chips from quick-action context", () => {
  const parsed = parseContextLineAttachments(
    "file: src/a.ts · branch: main · attached: .dockerignore (local workspace)"
  );
  assert.equal(parsed.withoutAttachments, "file: src/a.ts · branch: main");
  assert.equal(parsed.attachments.length, 1);
});

console.log(`\nparseHistoryAttachments: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
