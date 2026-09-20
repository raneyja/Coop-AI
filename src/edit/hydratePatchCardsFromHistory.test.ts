import "../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import {
  filePathFromEditHistoryContent,
  hydratePatchCardsFromHistory,
  patchCardsForMessages
} from "./hydratePatchCardsFromHistory";
import { getPatchRecord, getSuppressedMessageTimestamps, listPatchCards, resetPatchSessionForTests, upsertPatchRecord } from "./patchSession";
import { buildPatchCardState, withSuppressionRegistry } from "./patchDiffPreview";
import { parsePatchResponse } from "./patchParser";
import { COMMENT_ONLY_REWRITE_REJECTED_ERROR } from "./snapPatchToSelection";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  resetPatchSessionForTests();
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

const SAMPLE_PATCH = [
  "File: `src/foo.ts`",
  "",
  "```patch",
  "<<<<<<< SEARCH",
  "const x = 1;",
  "=======",
  "const x = 2;",
  ">>>>>>> REPLACE",
  "```"
].join("\n");

function otherPatch(path: string): string {
  return [
    `File: \`${path}\``,
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "a",
    "=======",
    "b",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
}

test("hydrates a Patch card from a persisted /edit assistant message", () => {
  const count = hydratePatchCardsFromHistory([
    { role: "user", content: "/edit add a comment", timestamp: 1 },
    { role: "assistant", content: SAMPLE_PATCH, timestamp: 2 }
  ]);
  assert.equal(count, 1);
  assert.equal(listPatchCards().length, 1);
  const card = listPatchCards()[0];
  assert.equal(card?.messageTimestamp, 2);
  assert.equal(card?.status, "pending");
  assert.equal(card?.suppressMarkdown, true);
  assert.equal(card?.files[0]?.relativePath, "src/foo.ts");
});

test("skips ordinary chat that is not a patch", () => {
  const count = hydratePatchCardsFromHistory([
    { role: "assistant", content: "Here is how that function works.", timestamp: 3 }
  ]);
  assert.equal(count, 0);
  assert.equal(listPatchCards().length, 0);
});

test("does not overwrite an applied card when the thread is reopened", () => {
  const parsed = parsePatchResponse(SAMPLE_PATCH);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const applied = withSuppressionRegistry({
    ...buildPatchCardState(parsed.patches, { status: "applied", messageTimestamp: 2 }),
    suppressMarkdown: true
  });
  upsertPatchRecord(2, parsed.patches, applied);
  const count = hydratePatchCardsFromHistory([
    { role: "assistant", content: SAMPLE_PATCH, timestamp: 2 }
  ]);
  assert.equal(count, 0);
  assert.equal(getPatchRecord(2)?.card.status, "applied");
});

test("patchCardsForMessages only returns cards for the open thread", () => {
  hydratePatchCardsFromHistory([
    { role: "assistant", content: SAMPLE_PATCH, timestamp: 10 },
    { role: "assistant", content: otherPatch("src/bar.ts"), timestamp: 20 }
  ]);
  const snapshot = patchCardsForMessages([{ timestamp: 10 }]);
  assert.equal(snapshot.cards.length, 1);
  assert.equal(snapshot.cards[0]?.messageTimestamp, 10);
  assert.deepEqual(snapshot.suppressedMessageTimestamps, [10]);
});

test("filePathFromEditHistoryContent reads the /edit file chip", () => {
  assert.equal(
    filePathFromEditHistoryContent(
      "/edit add a one-line comment\nfile: src/server/authMiddleware.ts · selection: L24–32"
    ),
    "src/server/authMiddleware.ts"
  );
});

test("hydrates a Patch card when the model omitted File: but the user chip has the path", () => {
  const content = [
    "```patch",
    "<<<<<<< SEARCH",
    "const x = 1;",
    "=======",
    "const x = 2;",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const count = hydratePatchCardsFromHistory([
    {
      role: "user",
      content: "/edit add a comment\nfile: src/foo.ts · selection: L1–1",
      timestamp: 1
    },
    { role: "assistant", content, timestamp: 2 }
  ]);
  assert.equal(count, 1);
  assert.equal(listPatchCards()[0]?.files[0]?.relativePath, "src/foo.ts");
});

test("unparseable patch markdown still stays suppressed after history echo", () => {
  const count = hydratePatchCardsFromHistory([
    { role: "user", content: "/edit rewrite this", timestamp: 1 },
    { role: "assistant", content: "```patch\nnot a real hunk\n```", timestamp: 2 }
  ]);
  assert.equal(count, 0);
  assert.ok(getSuppressedMessageTimestamps().includes(2));
  const snapshot = patchCardsForMessages([{ timestamp: 1 }, { timestamp: 2 }]);
  assert.ok(snapshot.suppressedMessageTimestamps?.includes(2));
});

test("hydrates from a composer edit chip without a /edit prefix", () => {
  const content = [
    "```patch",
    "<<<<<<< SEARCH",
    "const x = 1;",
    "=======",
    "const x = 2;",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const count = hydratePatchCardsFromHistory([
    {
      role: "user",
      content: "add a comment\nfile: src/foo.ts · selection: L1–1",
      timestamp: 1
    },
    { role: "assistant", content, timestamp: 2 }
  ]);
  assert.equal(count, 1);
  assert.equal(listPatchCards()[0]?.files[0]?.relativePath, "src/foo.ts");
  assert.equal(listPatchCards()[0]?.status, "pending");
});

test("retries a failed empty record once File: can be inferred from the user chip", () => {
  const content = [
    "```patch",
    "<<<<<<< SEARCH",
    "const x = 1;",
    "=======",
    "const x = 2;",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  upsertPatchRecord(
    2,
    { files: [] },
    {
      status: "failed",
      messageTimestamp: 2,
      fileCount: 0,
      hunkCount: 0,
      files: [],
      error: "Patch blocks found but no File: header",
      suppressMarkdown: true
    }
  );
  const count = hydratePatchCardsFromHistory([
    {
      role: "user",
      content: "/edit add a comment\nfile: src/foo.ts · selection: L1–1",
      timestamp: 1
    },
    { role: "assistant", content, timestamp: 2 }
  ]);
  assert.equal(count, 1);
  assert.equal(getPatchRecord(2)?.card.status, "pending");
  assert.equal(getPatchRecord(2)?.card.files[0]?.relativePath, "src/foo.ts");
});

test("does not revive a comment-only rewrite rejection as a pending Apply card", () => {
  upsertPatchRecord(
    2,
    { files: [] },
    {
      status: "failed",
      messageTimestamp: 2,
      fileCount: 0,
      hunkCount: 0,
      files: [],
      error: COMMENT_ONLY_REWRITE_REJECTED_ERROR,
      suppressMarkdown: true
    }
  );
  const count = hydratePatchCardsFromHistory([
    {
      role: "user",
      content: "/edit add a comment above this. Do not change any code.",
      timestamp: 1
    },
    { role: "assistant", content: SAMPLE_PATCH, timestamp: 2 }
  ]);
  assert.equal(count, 0);
  assert.equal(getPatchRecord(2)?.card.status, "failed");
});

console.log(`\nhydratePatchCardsFromHistory: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
