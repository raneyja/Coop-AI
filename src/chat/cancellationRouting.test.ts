import assert from "node:assert/strict";
import { CoopChatSession } from "./CoopChatSession";
import { ThreadRunManager } from "./chatTurn";
import { emptyChatIntentPlan } from "./intentPlanner/types";

type SessionInternals = Record<string, unknown> & {
  clearCancelledTurnState: (threadId: string) => void;
};

function sessionWithState(): SessionInternals {
  const session = Object.create(CoopChatSession.prototype) as SessionInternals;
  Object.assign(session, {
    threadStore: undefined,
    lastContextBundle: [{ type: "slack_search", content: "cancelled integration" }],
    lastTraceDecisionTimeline: { file: "src/old.ts" },
    pendingChatLocalFiles: { source: "local-workspace", files: [{ path: "old.ts" }] },
    pendingChatAttachFullFile: true,
    pendingChatMentions: [{ path: "old.ts" }],
    pendingQuickActionSuggest: { focus: "old action" },
    pendingCodeEditIntent: true,
    pendingDualRepoCompare: { left: {}, right: {} },
    pendingEvidenceArtifactId: "old-evidence",
    lastJobResult: { status: "running" },
    turnStreamAbort: new AbortController().signal,
    turnAgentAction: "edit",
    turnAllowsRepoTools: false,
    activityFeedbackThreadId: "session",
    lastActivityMessagesByThread: new Map([["session", ["old activity"]]]),
    chatDeliverableNarrative: new Map([
      ["session:old", ["old narrative"]],
      ["other:keep", ["other narrative"]]
    ])
  });
  return session;
}

async function run(): Promise<void> {
  const session = sessionWithState();
  session.clearCancelledTurnState("session");

  assert.deepEqual(session.lastContextBundle, []);
  assert.equal(session.lastTraceDecisionTimeline, undefined);
  assert.equal(session.pendingChatLocalFiles, undefined);
  assert.equal(session.pendingChatAttachFullFile, false);
  assert.equal(session.pendingChatMentions, undefined);
  assert.equal(session.pendingQuickActionSuggest, undefined);
  assert.equal(session.pendingCodeEditIntent, false);
  assert.equal(session.pendingDualRepoCompare, undefined);
  assert.equal(session.pendingEvidenceArtifactId, undefined);
  assert.equal(session.lastJobResult, undefined);
  assert.equal(session.turnStreamAbort, undefined);
  assert.equal(session.turnAgentAction, "none");
  assert.equal(session.turnAllowsRepoTools, true);
  assert.equal(session.activityFeedbackThreadId, undefined);
  assert.equal((session.lastActivityMessagesByThread as Map<string, unknown>).has("session"), false);
  assert.deepEqual(
    (session.chatDeliverableNarrative as Map<string, unknown>).get("other:keep"),
    ["other narrative"]
  );
  assert.equal((session.chatDeliverableNarrative as Map<string, unknown>).has("session:old"), false);

  const other = sessionWithState();
  Object.assign(other, { threadStore: { getActiveThreadId: () => "other" } });
  other.clearCancelledTurnState("session");
  assert.equal((other.lastContextBundle as unknown[]).length, 1, "Stop must not clear another active thread");

  const manager = new ThreadRunManager();
  const oldTurn = manager.begin({
    threadId: "session",
    context: {},
    history: [],
    artifacts: [],
    sessionCostUsd: 0,
    modelMessage: "old integration hunt",
    intentPlan: emptyChatIntentPlan("old integration hunt")
  });
  const mirrorSession = Object.assign(Object.create(CoopChatSession.prototype), {
    threadRuns: manager,
    lastContextBundle: [{ requestId: "follow-up", type: "chat_context", data: {} }],
    lastJobResult: { status: "follow-up" },
    pendingEvidenceArtifactId: "follow-up-evidence",
    lastTraceDecisionTimeline: { file: "follow-up.ts" },
    sessionMirrorTurnId: undefined,
    isViewingThread: () => true
  }) as Record<string, unknown>;
  manager.abort("session");
  const followUp = manager.begin({
    threadId: "session",
    context: {},
    history: [],
    artifacts: [],
    sessionCostUsd: 0,
    modelMessage: "plain follow-up",
    intentPlan: emptyChatIntentPlan("plain follow-up")
  });
  assert.equal(manager.isStreamActive(oldTurn), false);
  assert.equal(manager.isStreamActive(followUp), true);
  const withTurnSessionMirrors = (CoopChatSession.prototype as unknown as {
    withTurnSessionMirrors: (this: Record<string, unknown>, turn: unknown, fn: () => Promise<void>) => Promise<void>;
  }).withTurnSessionMirrors;
  await withTurnSessionMirrors.call(mirrorSession, oldTurn, async () => {
    mirrorSession.lastContextBundle = [{ requestId: "canceled", type: "chat_context", data: {} }];
  });
  assert.deepEqual(
    mirrorSession.lastContextBundle,
    [{ requestId: "follow-up", type: "chat_context", data: {} }],
    "a canceled mirror callback must not overwrite the follow-up bundle"
  );
  console.log("cancellationRouting: 3/3 tests passed");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
