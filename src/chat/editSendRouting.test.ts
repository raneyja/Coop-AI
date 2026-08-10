import assert from "node:assert/strict";
import {
  EDIT_NO_TARGET_FILE_ERROR,
  EDIT_UNREADABLE_FILE_ERROR,
  hasEditTargetInScope,
  isConcreteFileEditAsk,
  resolveEditEditorSnapPreference,
  resolveEditTrackingMessage,
  shouldBypassAdvisoryGroundingForEdit,
  shouldTrackEditRequest
} from "./editSendRouting";

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

test("isConcreteFileEditAsk detects applyable identifier validation asks", () => {
  assert.equal(
    isConcreteFileEditAsk(
      "On `validate_identifier`, add a clear validation error when the project identifier is empty or whitespace-only. Show the exact change to apply in this file."
    ),
    true
  );
});

test("isConcreteFileEditAsk rejects advisory where/which questions", () => {
  assert.equal(
    isConcreteFileEditAsk(
      "We’re adding a “blocked by” link type on issues. Where should validation live, and which existing link types in this mapper / IssueRelationViewSet should I mirror?"
    ),
    false
  );
});

test("isConcreteFileEditAsk rejects ownership / archaeology asks", () => {
  assert.equal(isConcreteFileEditAsk("Who owns workspace API permissions for this code?"), false);
  assert.equal(
    isConcreteFileEditAsk("Why do we model issue states with StateGroup this way?"),
    false
  );
});

test("isConcreteFileEditAsk rejects blast-shaped what-breaks asks with change/rename + backticks", () => {
  assert.equal(
    isConcreteFileEditAsk(
      "What breaks if we change or rename `MAX_USER_FACING_RESPONSE_MS` or `remainingContextGatherBudgetMs`?"
    ),
    false
  );
  assert.equal(
    isConcreteFileEditAsk("What breaks if I change this handler?"),
    false
  );
});

test("shouldTrackEditRequest is true for edit composer without quick action", () => {
  assert.equal(shouldTrackEditRequest({ composerMode: "edit" }, undefined), true);
});

test("shouldTrackEditRequest is false for ask composer or quick actions", () => {
  assert.equal(shouldTrackEditRequest({ composerMode: "ask" }, undefined), false);
  assert.equal(shouldTrackEditRequest({ composerMode: "edit" }, "explain"), false);
  assert.equal(shouldTrackEditRequest(undefined, undefined), false);
});

test("resolveEditTrackingMessage prefers historyContent over raw message", () => {
  assert.equal(
    resolveEditTrackingMessage("fix the bug", {
      composerMode: "edit",
      historyContent: "/edit fix the bug"
    }),
    "/edit fix the bug"
  );
});

test("resolveEditTrackingMessage appends mention scope to bubble text", () => {
  const content = resolveEditTrackingMessage("update auth flow", { composerMode: "edit" }, [
    { path: "src/auth.ts", label: "src/auth.ts" }
  ]);
  assert.match(content, /update auth flow/);
  assert.match(content, /src\/auth\.ts/);
});

test("hasEditTargetInScope requires active remote/local file or @mention for composerMode edit", () => {
  assert.equal(hasEditTargetInScope({}), false);
  assert.equal(hasEditTargetInScope({ file: "   " }), false);
  assert.equal(hasEditTargetInScope({ file: "src/config/responseDeadline.ts" }), true);
  assert.equal(hasEditTargetInScope({ mentionCount: 1 }), true);
  assert.equal(
    hasEditTargetInScope({ file: "src/config/responseDeadline.ts", mentionCount: 0 }),
    true
  );
});

test("shouldBypassAdvisoryGroundingForEdit blocks PENDING/OPEN status hijacks on /edit", () => {
  assert.equal(shouldBypassAdvisoryGroundingForEdit("edit"), true);
  assert.equal(shouldBypassAdvisoryGroundingForEdit("ask"), false);
  assert.equal(shouldBypassAdvisoryGroundingForEdit(undefined), false);
});

test("resolveEditEditorSnapPreference prefers remote tabs for /edit (Zero-Clone)", () => {
  assert.equal(
    resolveEditEditorSnapPreference({ composerMode: "edit", remoteProvenance: false }),
    "remote-then-local"
  );
  assert.equal(
    resolveEditEditorSnapPreference({ composerMode: "edit", remoteProvenance: true }),
    "remote-only"
  );
  assert.equal(
    resolveEditEditorSnapPreference({ composerMode: "ask", remoteProvenance: false }),
    "local-then-any"
  );
  assert.equal(
    resolveEditEditorSnapPreference({ remoteProvenance: true }),
    "remote-only"
  );
});

test("edit error copy stays actionable (no silent ask demotion)", () => {
  assert.match(EDIT_NO_TARGET_FILE_ERROR, /Open a file/i);
  assert.match(EDIT_NO_TARGET_FILE_ERROR, /\/edit/);
  assert.match(EDIT_UNREADABLE_FILE_ERROR, /Could not read/i);
  assert.match(EDIT_UNREADABLE_FILE_ERROR, /remote file/i);
});

console.log(`\neditSendRouting: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
