import assert from "node:assert/strict";
import {
  buildMissingIntentClarificationResponse,
  buildMissingRepoSelectionResponse,
  hasDiscernibleChatIntent,
  messageNeedsSelectedRepo,
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
  assert.equal(hasDiscernibleChatIntent("billing"), true);
});

test("hasDiscernibleChatIntent rejects pings and greetings", () => {
  assert.equal(hasDiscernibleChatIntent("test"), false);
  assert.equal(hasDiscernibleChatIntent("hi"), false);
  assert.equal(hasDiscernibleChatIntent("hello"), false);
  assert.equal(hasDiscernibleChatIntent("hey"), false);
  assert.equal(hasDiscernibleChatIntent("yo"), false);
  assert.equal(hasDiscernibleChatIntent("ping"), false);
  assert.equal(hasDiscernibleChatIntent("ok"), false);
});

test("hasDiscernibleChatIntent accepts multi-word asks that mention test", () => {
  assert.equal(hasDiscernibleChatIntent("write a test for login"), true);
  assert.equal(hasDiscernibleChatIntent("where are the tests"), true);
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

test("shouldClarifyFirstChatTurn treats first-turn pings as missing intent", () => {
  const ping = {
    hasPriorThreadMessages: false,
    hasQuickAction: false,
    hasAttachments: false,
    hasMentions: false,
    hasSourceHint: false,
    hasIntegrationProvider: false
  };
  assert.equal(shouldClarifyFirstChatTurn({ ...ping, message: "test" }), true);
  assert.equal(shouldClarifyFirstChatTurn({ ...ping, message: "hi" }), true);
  assert.equal(
    shouldClarifyFirstChatTurn({ ...ping, message: "write a test for login" }),
    false
  );
  assert.equal(
    shouldClarifyFirstChatTurn({ ...ping, message: "test", hasPriorThreadMessages: true }),
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

test("messageNeedsSelectedRepo catches this-repo asks and hunts, not pings", () => {
  assert.equal(messageNeedsSelectedRepo("tell me about this repo in story format"), true);
  assert.equal(messageNeedsSelectedRepo("how many files are in this repo?"), true);
  assert.equal(messageNeedsSelectedRepo("Where is requireAuth defined?"), true);
  assert.equal(messageNeedsSelectedRepo("what repo are you looking at"), true);
  assert.equal(messageNeedsSelectedRepo("which repository is selected"), true);
  assert.equal(messageNeedsSelectedRepo("test"), false);
  assert.equal(messageNeedsSelectedRepo("hi"), false);
});

test("buildMissingRepoSelectionResponse asks the user to Use repo", () => {
  const response = buildMissingRepoSelectionResponse();
  assert.match(response, /No repository is selected/i);
  assert.match(response, /Use repo/i);
  assert.equal(/InspectIQ/i.test(response), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
