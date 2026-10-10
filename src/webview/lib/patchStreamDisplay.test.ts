import assert from "node:assert/strict";
import {
  isAssistantReplyToEdit,
  isEditHistoryContent,
  looksLikePatchStreamingContent,
  shouldUseSuggestClarifyingBody
} from "./patchStreamDisplay";

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

test("looksLikePatchStreamingContent detects SEARCH markers", () => {
  assert.equal(looksLikePatchStreamingContent("<<<<<<< SEARCH\nfoo"), true);
});

test("looksLikePatchStreamingContent detects File header mid-stream", () => {
  assert.equal(
    looksLikePatchStreamingContent("File: `packages/lib/foo.ts`\n\n```"),
    true
  );
});

test("looksLikePatchStreamingContent ignores normal chat", () => {
  assert.equal(looksLikePatchStreamingContent("Here is how auth works in this file."), false);
});

test("isEditHistoryContent matches /edit bubbles", () => {
  assert.equal(isEditHistoryContent("/edit rewrite this\nfile: a.ts · selection: L1–2"), true);
  assert.equal(isEditHistoryContent("[edit] add a comment\nfile: a.ts · selection: L1–2"), true);
  assert.equal(isEditHistoryContent("explain this function"), false);
  assert.equal(
    isEditHistoryContent("add a comment\nfile: src/a.ts · selection: L1–2"),
    false
  );
});

test("isAssistantReplyToEdit is true only for the assistant turn after /edit", () => {
  const messages = [
    { role: "user", content: "/edit add a comment\nfile: src/a.ts · selection: L1–2", timestamp: 1 },
    { role: "assistant", content: "```patch\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n```", timestamp: 2 },
    { role: "user", content: "how does auth work?", timestamp: 3 },
    { role: "assistant", content: "It checks the bearer token.", timestamp: 4 }
  ];
  assert.equal(isAssistantReplyToEdit(messages, 2), true);
  assert.equal(isAssistantReplyToEdit(messages, 4), false);
  assert.equal(isAssistantReplyToEdit(messages, undefined), false);
});

test("isAssistantReplyToEdit is false for a later explain turn after /edit", () => {
  const messages = [
    { role: "user", content: "/edit add a comment", timestamp: 1 },
    { role: "assistant", content: "```patch\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n```", timestamp: 2 },
    { role: "user", content: "explain this function\nfile: src/a.ts · selection: L1–2", timestamp: 3 },
    { role: "assistant", content: "It checks the org.", timestamp: 4 }
  ];
  assert.equal(isAssistantReplyToEdit(messages, 4), false);
});

test("/fix and edit aliases retain patch-reply display behavior in restored history", () => {
  for (const token of ["fix", "repair", "patch"]) {
    const messages = JSON.parse(JSON.stringify([
      { role: "user", content: `/${token} improve the pending error\nfile: packages/lib/server-only/field/sign-field-with-token.ts · branch: main`, timestamp: 1 },
      { role: "assistant", content: "File: packages/lib/server-only/field/sign-field-with-token.ts\n```patch\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n```", timestamp: 2 },
      { role: "user", content: "Explain the guard", timestamp: 3 },
      { role: "assistant", content: "The guard requires PENDING.", timestamp: 4 }
    ]));
    assert.equal(isEditHistoryContent(messages[0].content), true);
    assert.equal(isAssistantReplyToEdit(messages, 2), true, `/${token} owns the patch reply`);
    assert.equal(isAssistantReplyToEdit(messages, 4), false, "ordinary follow-up does not inherit patch display");
  }
  for (const command of ["/blast auth", "/understand", "/slack signing", "/compare plane documenso"]) {
    assert.equal(isEditHistoryContent(command), false);
  }
});

test("shouldUseSuggestClarifyingBody stays off for patch bodies so the card can attach", () => {
  const patch = "```patch\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n```";
  assert.equal(shouldUseSuggestClarifyingBody("Did you mean Find Owner?", true), true);
  assert.equal(shouldUseSuggestClarifyingBody(patch, true), false);
  assert.equal(shouldUseSuggestClarifyingBody(patch, false), false);
});

console.log(`\npatchStreamDisplay: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
