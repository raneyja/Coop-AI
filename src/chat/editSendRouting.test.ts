import assert from "node:assert/strict";
import {
  EDIT_NO_TARGET_FILE_ERROR,
  EDIT_NO_TARGET_WITHOUT_AGENT_ERROR,
  EDIT_UNREADABLE_FILE_ERROR,
  hasEditTargetInScope,
  isConcreteFileEditAsk,
  resolveChangeSendRouting,
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

test("isConcreteFileEditAsk accepts a named symbol as the target (Copilot /fix shape)", () => {
  assert.equal(
    isConcreteFileEditAsk(
      "fix extractBearerToken throws if headers is missing. Guard it so undefined headers return undefined. Don't change requireAuth."
    ),
    true
  );
  assert.equal(isConcreteFileEditAsk("add a guard to get_queryset for missing workspace"), true);
  assert.equal(isConcreteFileEditAsk("update AuthContext to carry the org plan"), true);
});

test("isConcreteFileEditAsk leaves repo-wide changes to the agent hunt", () => {
  assert.equal(
    isConcreteFileEditAsk("Rename verifyToken to validateToken across the repo"),
    false
  );
  assert.equal(isConcreteFileEditAsk("Remove legacyApiToken everywhere"), false);
});

test("isConcreteFileEditAsk still rejects a named symbol inside an advisory ask", () => {
  assert.equal(
    isConcreteFileEditAsk("Why do we change requireInProduction in requireAuth?"),
    false
  );
  assert.equal(isConcreteFileEditAsk("What breaks if we rename extractBearerToken?"), false);
});

test("named symbol without an edit verb is not an edit ask", () => {
  assert.equal(isConcreteFileEditAsk("Where is extractBearerToken defined?"), false);
  assert.equal(isConcreteFileEditAsk("Explain requireAuth in this file"), false);
});

test("J4: prose fix + open file lands on the anchored Patch card, not the hunt", () => {
  const ask =
    "fix extractBearerToken throws if headers is missing. Guard it so undefined headers return undefined.";
  assert.deepEqual(
    resolveChangeSendRouting({
      explicitEdit: false,
      concreteEditAsk: isConcreteFileEditAsk(ask),
      hasEditTarget: hasEditTargetInScope({ file: "src/server/authMiddleware.ts" }),
      agentCanOwnChange: true
    }),
    { kind: "anchored-edit" }
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

test("resolveChangeSendRouting: no file + Agent can hunt → agent-change (not hard error)", () => {
  assert.deepEqual(
    resolveChangeSendRouting({
      explicitEdit: false,
      concreteEditAsk: true,
      hasEditTarget: false,
      agentCanOwnChange: true
    }),
    { kind: "agent-change" }
  );
});

test("resolveChangeSendRouting: no file + cannot hunt → reject with hunt hint", () => {
  const decision = resolveChangeSendRouting({
    explicitEdit: false,
    concreteEditAsk: true,
    hasEditTarget: false,
    agentCanOwnChange: false
  });
  assert.equal(decision.kind, "reject-no-target");
  if (decision.kind === "reject-no-target") {
    assert.match(decision.message, /find the code and propose a patch/i);
  }
});

test("resolveChangeSendRouting: file in scope → anchored-edit", () => {
  assert.deepEqual(
    resolveChangeSendRouting({
      explicitEdit: false,
      concreteEditAsk: true,
      hasEditTarget: true,
      agentCanOwnChange: true
    }),
    { kind: "anchored-edit" }
  );
});

test("resolveChangeSendRouting: explicit /edit without file still rejects", () => {
  const decision = resolveChangeSendRouting({
    explicitEdit: true,
    concreteEditAsk: false,
    hasEditTarget: false,
    agentCanOwnChange: true
  });
  assert.equal(decision.kind, "reject-no-target");
  if (decision.kind === "reject-no-target") {
    assert.match(decision.message, /Open a file/i);
  }
});

test("edit error copy stays actionable (no silent ask demotion)", () => {
  assert.match(EDIT_NO_TARGET_FILE_ERROR, /Open a file/i);
  assert.match(EDIT_NO_TARGET_FILE_ERROR, /\/edit/);
  assert.match(EDIT_NO_TARGET_WITHOUT_AGENT_ERROR, /propose a patch/i);
  assert.match(EDIT_UNREADABLE_FILE_ERROR, /Could not read/i);
  assert.match(EDIT_UNREADABLE_FILE_ERROR, /remote file/i);
});

console.log(`\neditSendRouting: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
