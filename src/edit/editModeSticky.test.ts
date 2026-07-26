import assert from "node:assert/strict";
import {
  buildEditOptionsReminderForTurn,
  resolveEditOptionRequest,
  resolveEffectiveComposerMode
} from "./editModeSticky";
import { resetPatchSessionForTests, upsertPatchVariants } from "./patchSession";
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

function pendingOptionCard(timestamp: number, variantCount: number): PatchCardState {
  return {
    status: "pending",
    messageTimestamp: timestamp,
    fileCount: 1,
    hunkCount: 1,
    variantCount,
    files: [{ relativePath: "src/a.ts", hunks: [] }]
  };
}

test("resolveEffectiveComposerMode keeps edit sticky after /edit history", () => {
  resetPatchSessionForTests();
  const mode = resolveEffectiveComposerMode(undefined, [
    {
      role: "user",
      content:
        "/edit can you provide me with 3 different options to update the code here.",
      timestamp: 1
    },
    { role: "assistant", content: "Option 1: ...", timestamp: 2 }
  ]);
  assert.equal(mode, "edit");
});

test("resolveEffectiveComposerMode keeps edit sticky while patch cards are open", () => {
  resetPatchSessionForTests();
  upsertPatchVariants(100, [
    {
      id: "v0",
      label: "Option 1: Replace",
      index: 0,
      patches: { files: [] },
      card: pendingOptionCard(100, 3)
    }
  ]);
  assert.equal(
    resolveEffectiveComposerMode(undefined, [
      { role: "user", content: "i want some code that replaces, not adds to it", timestamp: 3 }
    ]),
    "edit"
  );
});

test("resolveEffectiveComposerMode ends after a later quick-action slash", () => {
  resetPatchSessionForTests();
  assert.equal(
    resolveEffectiveComposerMode(undefined, [
      { role: "user", content: "/edit rename this helper", timestamp: 1 },
      { role: "assistant", content: "done", timestamp: 2 },
      { role: "user", content: "/gaps auth flow", timestamp: 3 }
    ]),
    undefined
  );
});

test("resolveEditOptionRequest inherits count from earlier option ask", () => {
  resetPatchSessionForTests();
  const request = resolveEditOptionRequest("i want some code that replaces, not adds to it", [
    {
      role: "user",
      content:
        "/edit can you provide me with 3 different options to update the code here. Underneath each option I would like a tl;dr summary.",
      timestamp: 1
    },
    { role: "assistant", content: "Option 1: ...", timestamp: 2 }
  ]);
  assert.deepEqual(request, { count: 3 });
});

test("buildEditOptionsReminderForTurn adds follow-up guidance", () => {
  resetPatchSessionForTests();
  const reminder = buildEditOptionsReminderForTurn(
    "i want some code that replaces, not adds to it",
    [
      {
        role: "user",
        content: "/edit give me 3 different options for this method",
        timestamp: 1
      }
    ]
  );
  assert.ok(reminder);
  assert.match(reminder!, /exactly 3 option blocks/);
  assert.match(reminder!, /edit_options_follow_up/);
  assert.match(reminder!, /Do not switch to plain markdown/);
});

console.log(`\neditModeSticky: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
