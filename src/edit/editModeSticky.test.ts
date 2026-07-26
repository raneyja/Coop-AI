import assert from "node:assert/strict";
import {
  buildEditRequestReminderForTurn,
  buildEditOptionsReminderForTurn,
  looksLikeAskIntent,
  looksLikeEditFollowUp,
  resolveEditOptionRequest,
  resolveEffectiveComposerMode
} from "./editModeSticky";
import {
  clearLastEditUserMessage,
  getLastEditUserMessage,
  resetPatchSessionForTests,
  setLastEditUserMessage,
  upsertPatchVariants
} from "./patchSession";
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

test("looksLikeAskIntent catches explain questions", () => {
  assert.equal(looksLikeAskIntent("whats this file do?"), true);
  assert.equal(looksLikeAskIntent("what does this block of code do?"), true);
  assert.equal(looksLikeAskIntent("explain this function"), true);
  assert.equal(looksLikeAskIntent("how does auth work here?"), true);
});

test("looksLikeAskIntent ignores /edit and patch refinements", () => {
  assert.equal(looksLikeAskIntent("/edit add a null check"), false);
  assert.equal(looksLikeAskIntent("make option 2 safer"), false);
  assert.equal(looksLikeAskIntent("replace, don't add"), false);
});

test("looksLikeEditFollowUp catches refinements only", () => {
  assert.equal(looksLikeEditFollowUp("i want some code that replaces, not adds to it"), true);
  assert.equal(looksLikeEditFollowUp("make option 2 safer"), true);
  assert.equal(looksLikeEditFollowUp("whats this file do?"), false);
  assert.equal(looksLikeEditFollowUp("what does this block of code do?"), false);
});

test("resolveEffectiveComposerMode does NOT sticky after bare /edit history", () => {
  resetPatchSessionForTests();
  const mode = resolveEffectiveComposerMode(
    undefined,
    [
      {
        role: "user",
        content:
          "/edit can you provide me with 3 different options to update the code here.",
        timestamp: 1
      },
      { role: "assistant", content: "Option 1: ...", timestamp: 2 }
    ],
    { currentMessage: "whats this file do?" }
  );
  assert.equal(mode, undefined);
});

test("resolveEffectiveComposerMode keeps edit sticky for patch refinements with open cards", () => {
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
    resolveEffectiveComposerMode(
      undefined,
      [{ role: "user", content: "i want some code that replaces, not adds to it", timestamp: 3 }],
      { currentMessage: "i want some code that replaces, not adds to it" }
    ),
    "edit"
  );
});

test("resolveEffectiveComposerMode breaks sticky for ask intent even with open cards", () => {
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
  setLastEditUserMessage("/edit give me 3 options");
  assert.equal(
    resolveEffectiveComposerMode(undefined, [], {
      currentMessage: "what does this block of code do?"
    }),
    undefined
  );
  assert.equal(getLastEditUserMessage(), undefined);
});

test("resolveEffectiveComposerMode honors explicit edit and ask", () => {
  resetPatchSessionForTests();
  assert.equal(resolveEffectiveComposerMode("edit", [], { currentMessage: "hi" }), "edit");
  assert.equal(
    resolveEffectiveComposerMode("ask", [], { currentMessage: "make option 2 safer" }),
    undefined
  );
});

test("resolveEffectiveComposerMode ends after a later quick-action slash is not required — ask is enough", () => {
  resetPatchSessionForTests();
  setLastEditUserMessage("/edit rename this helper");
  assert.equal(
    resolveEffectiveComposerMode(
      undefined,
      [
        { role: "user", content: "/edit rename this helper", timestamp: 1 },
        { role: "assistant", content: "done", timestamp: 2 },
        { role: "user", content: "what does this helper do?", timestamp: 3 }
      ],
      { currentMessage: "what does this helper do?" }
    ),
    undefined
  );
});

test("resolveEditOptionRequest inherits count only for follow-ups", () => {
  resetPatchSessionForTests();
  const history = [
    {
      role: "user" as const,
      content:
        "/edit can you provide me with 3 different options to update the code here. Underneath each option I would like a tl;dr summary.",
      timestamp: 1
    },
    { role: "assistant" as const, content: "Option 1: ...", timestamp: 2 }
  ];
  assert.deepEqual(
    resolveEditOptionRequest("i want some code that replaces, not adds to it", history),
    { count: 3 }
  );
  assert.equal(resolveEditOptionRequest("whats this file do?", history), undefined);
  assert.equal(resolveEditOptionRequest("/edit add a null check", history), undefined);
});

test("buildEditRequestReminderForTurn always quotes the user sentence", () => {
  resetPatchSessionForTests();
  const ask = "/edit can you recommend 2 changes to this block that i can make?";
  const reminder = buildEditRequestReminderForTurn(ask, []);
  assert.match(reminder, /edit_user_request/);
  assert.match(reminder, /recommend 2 changes/);
  assert.match(reminder, /Follow the user's exact request/);
  assert.match(reminder, /exactly 2 Option blocks/);
});

test("buildEditRequestReminderForTurn still quotes when count is not regex-parsed", () => {
  resetPatchSessionForTests();
  const ask = "/edit please give a couple of alternate rewrites for this helper";
  const reminder = buildEditRequestReminderForTurn(ask, []);
  assert.match(reminder, /edit_user_request/);
  assert.match(reminder, /couple of alternate rewrites/);
  assert.match(reminder, /Do what the sentence asks/);
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
  assert.match(reminder, /exactly 3/);
  assert.match(reminder, /edit_options_follow_up|edit_user_request/);
});

test("clearLastEditUserMessage clears session sticky marker", () => {
  resetPatchSessionForTests();
  setLastEditUserMessage("/edit foo");
  clearLastEditUserMessage();
  assert.equal(getLastEditUserMessage(), undefined);
});

console.log(`\neditModeSticky: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
