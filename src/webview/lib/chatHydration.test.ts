import assert from "node:assert/strict";
import { historyAcknowledgesPendingUser, shouldAcceptHistory, shouldResetComposerDraft, persistedChatPanelState } from "./chatHydration";
import type { ChatHistoryPayload } from "../../chat/types";

const snapshot: ChatHistoryPayload = { threadId: "new", revision: 2, messages: [], artifacts: [] };
assert.equal(shouldAcceptHistory(snapshot, undefined, 0), true, "initial hydration accepts empty history");
assert.equal(shouldAcceptHistory(snapshot, "new", 1), true);
assert.equal(shouldAcceptHistory(snapshot, "old", 1), false, "foreign thread history is rejected");
assert.equal(shouldAcceptHistory(snapshot, "new", 2), false, "duplicate history is rejected");
assert.equal(shouldAcceptHistory(snapshot, "new", 3), false, "delayed history is rejected");
assert.equal(historyAcknowledgesPendingUser([], "submit-2"), false, "empty hydration cannot erase an optimistic prompt");
assert.equal(historyAcknowledgesPendingUser([{ role: "user", content: "legacy", timestamp: 99 }], "submit-2"), false, "untagged legacy history cannot acknowledge an active submit");
const user = { role: "user" as const, content: "hunt", timestamp: 1, clientSubmissionId: "submit-1" };
assert.equal(historyAcknowledgesPendingUser([user], "submit-1"), true);
assert.equal(historyAcknowledgesPendingUser([user], "submit-2"), false, "previous turn cannot acknowledge the new prompt");
assert.equal(historyAcknowledgesPendingUser([user, { ...user, timestamp: 2, clientSubmissionId: "unrelated-newer" }], "submit-2"), false, "a newer unrelated user cannot acknowledge the prompt");
assert.equal(historyAcknowledgesPendingUser([{ ...user, clientSubmissionId: "submit-2" }], "submit-2"), true);
assert.equal(shouldResetComposerDraft(true), false, "account/thread hydration preserves the restored draft");
assert.equal(shouldResetComposerDraft(false), true, "explicit new/switch resets the draft");
assert.equal(shouldResetComposerDraft(undefined), true, "legacy explicit thread changes still reset");
console.log("chat hydration lifecycle checks passed");

assert.deepEqual(persistedChatPanelState("unsent draft", "panel-one"), {draftInput: "unsent draft", sessionId: "panel-one"});
assert.deepEqual(persistedChatPanelState("sidebar draft"), {draftInput: "sidebar draft"});
