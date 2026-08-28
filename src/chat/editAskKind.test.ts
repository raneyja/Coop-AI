import assert from "node:assert/strict";
import { isCommentOnlyEditAsk, resolveEditAskKind } from "./editAskKind";

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

test("/edit leave a comment above the highlight is comment-only", () => {
  assert.equal(
    resolveEditAskKind("/edit please leave a comment above this with a summary of what it does"),
    "comment"
  );
  assert.equal(isCommentOnlyEditAsk("add a one-line comment above the selected function."), true);
});

test("one-sentence follow-up after a comment /edit stays comment-only", () => {
  assert.equal(
    resolveEditAskKind("just make it one sentance,", {
      priorUserMessages: [
        "/edit please leave a comment above this with a summary of what it does\nfile: src/CoopSidebarProvider.ts · selection: L29–34"
      ]
    }),
    "comment"
  );
  assert.equal(resolveEditAskKind("just make it one sentence"), "comment");
});

test("rewrite / shorten the highlight is not comment-only", () => {
  assert.equal(resolveEditAskKind("/edit shorten this highlighted block"), "rewrite");
  assert.equal(resolveEditAskKind("rewrite the highlighted lines to be more efficient"), "rewrite");
  assert.equal(isCommentOnlyEditAsk("refactor this constructor"), false);
});

test("rewrite the comment still counts as comment-only", () => {
  assert.equal(resolveEditAskKind("rewrite the comment above this to be clearer"), "comment");
});

test("/edit by itself is not a rewrite", () => {
  assert.equal(resolveEditAskKind("/edit"), "default");
  assert.equal(resolveEditAskKind("/edit please leave a comment above this"), "comment");
});

test("C3 one-line JSDoc /edit stays comment-only", () => {
  assert.equal(
    resolveEditAskKind(
      '/edit Add a one-line JSDoc above extractBearerToken: returns the token after "Bearer " or undefined. Do not change the function body or any other line.'
    ),
    "comment"
  );
});

test("ordinary change asks stay default (do exactly the words)", () => {
  assert.equal(resolveEditAskKind("/edit add a null check to the login handler"), "default");
  assert.equal(resolveEditAskKind("wire up the new helper in this file"), "default");
});

console.log(`\neditAskKind: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
