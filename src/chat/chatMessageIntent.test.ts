import assert from "node:assert/strict";
import {
  buildMissingIntentClarificationResponse,
  hasDiscernibleChatIntent,
  shouldClarifyFirstChatTurn
} from "./chatMessageIntent";

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

test("hasDiscernibleChatIntent rejects keyboard mash", () => {
  assert.equal(hasDiscernibleChatIntent("asdfsdagsd"), false);
  assert.equal(hasDiscernibleChatIntent("xkjhqwrtzx"), false);
});

test("hasDiscernibleChatIntent accepts real questions", () => {
  assert.equal(hasDiscernibleChatIntent("What does this file do?"), true);
  assert.equal(hasDiscernibleChatIntent("how does auth work"), true);
  assert.equal(hasDiscernibleChatIntent("explain dockerignore"), true);
});

test("hasDiscernibleChatIntent accepts short meaningful tokens", () => {
  assert.equal(hasDiscernibleChatIntent("auth"), true);
  assert.equal(hasDiscernibleChatIntent("help"), true);
});

test("hasDiscernibleChatIntent rejects empty and punctuation-only input", () => {
  assert.equal(hasDiscernibleChatIntent(""), false);
  assert.equal(hasDiscernibleChatIntent("   "), false);
  assert.equal(hasDiscernibleChatIntent("?"), false);
});

test("shouldClarifyFirstChatTurn only on first plain chat turn", () => {
  assert.equal(
    shouldClarifyFirstChatTurn({
      message: "asdfsdagsd",
      hasPriorThreadMessages: false,
      hasQuickAction: false,
      hasAttachments: false,
      hasMentions: false,
      hasSourceHint: false,
      hasIntegrationProvider: false
    }),
    true
  );

  assert.equal(
    shouldClarifyFirstChatTurn({
      message: "asdfsdagsd",
      hasPriorThreadMessages: true,
      hasQuickAction: false,
      hasAttachments: false,
      hasMentions: false,
      hasSourceHint: false,
      hasIntegrationProvider: false
    }),
    false
  );
});

test("shouldClarifyFirstChatTurn skips explicit actions and attachments", () => {
  assert.equal(
    shouldClarifyFirstChatTurn({
      message: "",
      hasPriorThreadMessages: false,
      hasQuickAction: true,
      hasAttachments: false,
      hasMentions: false,
      hasSourceHint: false,
      hasIntegrationProvider: false
    }),
    false
  );

  assert.equal(
    shouldClarifyFirstChatTurn({
      message: "",
      hasPriorThreadMessages: false,
      hasQuickAction: false,
      hasAttachments: true,
      hasMentions: false,
      hasSourceHint: false,
      hasIntegrationProvider: false
    }),
    false
  );
});

test("buildMissingIntentClarificationResponse includes repo and file hints", () => {
  const response = buildMissingIntentClarificationResponse({
    owner: "acme",
    repo: "widgets",
    file: ".dockerignore"
  });
  assert.match(response, /acme\/widgets/);
  assert.match(response, /\.dockerignore/);
  assert.match(response, /^\*\*Answer\*\*/m);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
