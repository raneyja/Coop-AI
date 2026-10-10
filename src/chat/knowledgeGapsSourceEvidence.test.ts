import assert from "node:assert/strict";
import { CoopChatSession } from "./CoopChatSession";
import { ChatThreadStore } from "./chatThreadStore";
import { enrichChatResponseForAction } from "./chatResponseEnrichment";

async function run(): Promise<void> {
  const body = "export const value = true;\n\n\nexport const fallback = false;";
  const saved = { id: "previous-gaps-source", kind: "knowledge-gaps", timestamp: 1,
    payload: { evidence: { focusFiles: [{ path: "src/state.ts", content: body }] } } };
  const stored = { id: "gaps-background", title: "Gaps", artifacts: [saved] };
  let persisted: Array<typeof saved> = [];
  const turn = {
    id: "gaps-turn", threadId: stored.id, history: [], sessionCostUsd: 0, artifacts: [],
    pendingEvidenceArtifactId: undefined as string | undefined,
    context: { owner: "org", repo: "board", branch: "release", provider: "github",
      file: "src/state.ts", fileSource: "remote" },
    contextBundle: [{ requestId: "gaps-source", type: "knowledge_gaps", fetchedAt: new Date(), data: {
      file: "src/state.ts", userFocus: "Before changing state validation, which rules need tests?",
      focusFiles: [{ path: "src/state.ts", content: body, startLine: 40, repoId: "github:org/board" }]
    } }]
  };
  const session = Object.assign(Object.create(CoopChatSession.prototype), {
    threadRuns: { isStreamActive: () => true },
    currentContext: { owner: "other", repo: "other", branch: "other", file: "other.ts", provider: "gitlab" },
    preferences: { defaultCodeHost: "gitlab" }, isViewingThread: () => false, threadArtifacts: [],
    threadStore: {
      getThreadById: (id: string) => { assert.equal(id, stored.id); return stored; },
      getActiveThread: () => { throw Error("Gaps sources must not use another active chat"); },
      setThread: (_id: string, _history: unknown, _cost: number, _title: string, artifacts: typeof persisted) => {
        persisted = artifacts;
      }
    },
    threadSyncOptions: () => ({ baseUrl: "https://api.example.test", getToken: async () => undefined }),
    post: () => { throw Error("Background Gaps must not post a card into another chat"); },
    persistActiveThread: () => { throw Error("Background Gaps must save its own Sources card"); }
  });
  await session.postEvidenceCardsFromBundle("knowledge-gaps", undefined, turn);
  assert.equal(persisted.length, 2, "early background gathering must save a card body, not just allocate an ID");
  const card = persisted[1] as unknown as { id: string; payload: { file: string; codeHost: string;
    evidence: { focusFiles: Array<{ path: string; content: string; repoId: string; startLine: number }> } } };
  assert.equal(card.id, turn.pendingEvidenceArtifactId);
  assert.equal(card.payload.file, "src/state.ts");
  assert.equal(card.payload.codeHost, "github");
  assert.deepEqual(card.payload.evidence.focusFiles[0], {
    path: "src/state.ts", content: body, startLine: 40, repoId: "github:org/board"
  });
  assert.equal(session.threadArtifacts.length, 0, "another chat's artifacts stay untouched");
  session.persistTurnThread(turn);
  session.persistTurnThread(turn);
  assert.equal(persisted.length, 2, "background completion preserves old and new Sources without duplication");

  // Exercise the production turn-persistence and restore path, not just a JSON
  // round trip of the formatter's output. VS Code storage serializes snapshots.
  const data = new Map<string, unknown>();
  const extensionContext = { workspaceState: {
    get: (key: string) => data.get(key), update: async (key: string, value: unknown) => {
      data.set(key, JSON.parse(JSON.stringify(value)));
    }
  } } as never;
  const store = new ChatThreadStore(extensionContext, "source-integrity-policy");
  const threadId = store.getActiveThreadId();
  const quote = "```40:43:src/state.ts\n" + body + "\n```";
  const secondQuote = "```43:43:src/state.ts\nexport const fallback = false;\n```";
  const content = "**Source-grounded review**\n\nThe shown constants have the quoted values.\n\n" + quote +
    "\n\nThe fallback definition is shown here.\n\n" + secondQuote +
    "\n\n**Open questions**\n\nWhat contract should use these values? Verify that with documentation or tests.";
  const final = enrichChatResponseForAction({ quickAction: "knowledge-gaps", content,
    owner: "org", repo: "board", activeRepoId: "github:org/board", contextBundle: turn.contextBundle });
  assert.ok(final.includes(quote));
  const persistedTurn = { ...turn, threadId, history: [] as Array<{role: string; content: string; timestamp: number}>, artifacts: persisted,
    sourceCitationWindows: [{path: "src/state.ts", content: body, startLine: 40}], sourceCitationMinimumQuotes: 2 };
  let completions = 0;
  const persistenceSession = Object.assign(Object.create(CoopChatSession.prototype), {
    threadStore: store, threadSyncOptions: () => ({baseUrl: "https://api.example.test", getToken: async () => undefined}),
    threadRuns: { isStreamActive: () => true, complete: () => { completions++; } },
    isViewingThread: () => false, pushThreadsList: () => undefined,
    groundAssistantCitationFences: () => { throw Error("A final answer must use the turn's frozen source, without another remote read"); }
  });
  await persistenceSession.finishTurnAssistantMessage(persistedTurn, {role: "assistant", content: final, timestamp: 2});
  assert.equal(completions, 1);
  const restored = new ChatThreadStore(extensionContext, "source-integrity-policy").getThreadById(threadId)!;
  assert.equal(restored.messages[0].content, final);
  assert.equal(restored.messages[0].sourceCitationMode, "explicit", "restore must retain the honest source-rendering policy");
  assert.ok(restored.messages[0].content.includes(quote));
  assert.equal(restored.repoContext?.branch, "release");
  const restoredCard = restored.artifacts[1] as typeof card;
  assert.equal(restoredCard.payload.evidence.focusFiles[0].content, body);
  for (const corrupted of [final.replace("value = true", "value = false"),
    final.replace("```40:43:src/state.ts", "```typescript"), final.replace(quote, "")]) {
    const rejectedTurn = { ...persistedTurn, history: [...persistedTurn.history], sessionCostUsd: 0.3 };
    await assert.rejects(persistenceSession.finishTurnAssistantMessage(rejectedTurn, {
      role: "assistant", content: corrupted, timestamp: 3
    }), /altered or missing source quotes/);
    const retained = new ChatThreadStore(extensionContext, "source-integrity-policy").getThreadById(threadId)!;
    assert.equal(retained.messages.length, 1, "a rejected final answer must never enter saved history");
    assert.equal(retained.messages[0].content, final);
    assert.equal(retained.sessionCostUsd, 0.3, "rejecting a final answer must retain known provider cost");
    assert.equal(completions, 1, "only the valid answer completes publication");
  }
  console.log("Gaps source policy: final publication and restore retain frozen quotes; altered, downgraded and removed quotes fail without losing known cost");
}
void run().catch(error => { console.error(error); process.exit(1); });
