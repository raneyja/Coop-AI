import assert from "node:assert/strict";
import {
  shouldHidePatchMarkdownForMessage,
  shouldRenderPatchCardForMessage
} from "./PatchCard";
import type { PatchCardState } from "../chat/types";

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

const baseFiles: PatchCardState["files"] = [
  {
    relativePath: "src/example.ts",
    hunks: [
      {
        id: "h1",
        matchStatus: "matched",
        lines: [
          { kind: "remove", text: "old" },
          { kind: "add", text: "new" }
        ]
      }
    ]
  }
];

test("pending card renders and hides markdown for matching message", () => {
  const cards: PatchCardState[] = [
    {
      status: "pending",
      messageTimestamp: 10,
      fileCount: 1,
      hunkCount: 1,
      files: baseFiles,
      suppressMarkdown: true
    }
  ];
  assert.equal(shouldRenderPatchCardForMessage(cards, 10), true);
  assert.equal(shouldHidePatchMarkdownForMessage(cards, 10), true);
  assert.equal(shouldRenderPatchCardForMessage(cards, 99), false);
});

test("rejected card stays in thread and keeps markdown hidden", () => {
  const cards: PatchCardState[] = [
    {
      status: "rejected",
      messageTimestamp: 10,
      fileCount: 1,
      hunkCount: 1,
      files: baseFiles,
      canUndo: true,
      suppressMarkdown: true
    }
  ];
  assert.equal(shouldRenderPatchCardForMessage(cards, 10), true);
  assert.equal(shouldHidePatchMarkdownForMessage(cards, 10), true);
});

test("a newer /edit patch keeps older card visible and markdown suppressed", () => {
  const cards: PatchCardState[] = [
    {
      status: "rejected",
      messageTimestamp: 10,
      fileCount: 1,
      hunkCount: 1,
      files: baseFiles,
      canUndo: true,
      suppressMarkdown: true
    },
    {
      status: "pending",
      messageTimestamp: 20,
      fileCount: 1,
      hunkCount: 1,
      files: baseFiles,
      suppressMarkdown: true,
      suppressedMessageTimestamps: [10, 20]
    }
  ];
  assert.equal(shouldHidePatchMarkdownForMessage(cards, 10, [10, 20]), true);
  assert.equal(shouldRenderPatchCardForMessage(cards, 10), true);
  assert.equal(shouldHidePatchMarkdownForMessage(cards, 20, [10, 20]), true);
  assert.equal(shouldRenderPatchCardForMessage(cards, 20), true);
});

test("suppress registry hides markdown even when card list is empty for that message", () => {
  assert.equal(shouldHidePatchMarkdownForMessage([], 10, [10]), true);
  assert.equal(shouldRenderPatchCardForMessage([], 10), false);
});

console.log(`\nPatchCard helpers: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
