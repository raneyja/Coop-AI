import "../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import {
  hydratePatchCardsFromHistory,
  patchCardsForMessages
} from "./hydratePatchCardsFromHistory";
import { getPatchRecord, listPatchCards, resetPatchSessionForTests, upsertPatchRecord } from "./patchSession";
import { buildPatchCardState, withSuppressionRegistry } from "./patchDiffPreview";
import { parsePatchResponse } from "./patchParser";

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

console.log(`\nhydratePatchCardsFromHistory: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
