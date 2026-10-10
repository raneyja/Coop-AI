import assert from "node:assert/strict";
import { CoopChatSession } from "./CoopChatSession";
import { blastRadiusFromBundle } from "../context/contextBundleEvidence";
import { buildBlastRadiusSynthesisUserPrompt } from "../prompts/blastRadiusSynthesis";
import { enrichChatResponseForAction } from "./chatResponseEnrichment";
import { validateBlastSourceCitations } from "../prompts/blastRadiusSourceGuard";
import { syncThreadToBackend } from "./threadSync";

async function run(): Promise<void> {
  const previousFetch = globalThis.fetch;
  let syncedMode: unknown;
  globalThis.fetch = (async (_url, init) => {
    syncedMode = JSON.parse(String(init?.body)).messages[0].metadata.sourceCitationMode;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await syncThreadToBackend({ id: "source-policy", title: "Source policy", createdAt: 1, updatedAt: 2,
      messageCount: 1, artifacts: [], sessionCostUsd: 0.1,
      messages: [{ role: "assistant", content: "Available source only.", timestamp: 1, sourceCitationMode: "explicit" }] },
      { baseUrl: "https://api.coop-ai.dev", getToken: async () => "fixture-token" });
    assert.equal(syncedMode, "explicit", "remote history metadata must retain the source renderer policy");
  } finally { globalThis.fetch = previousFetch; }
  const code = "if (ready) {\n\n\n  // Sources: this is a source comment, not narrative metadata.\n  persist();\n}";
  const finalEvidence = { file: "src/action.ts", directDependents: ["src/caller.ts"], sourceFiles: [{
    path: "src/action.ts", content: code, startLine: 1, endLine: 6, role: "target" as const,
    repoId: "github:org/project", branch: "release", truncated: false
  }] };
  const citation = "```1:6:src/action.ts\n" + code + "\n```";
  const finalAnswer = enrichChatResponseForAction({ quickAction: "blast-radius",
    content: "**Summary**\n\nAvailable conditions:\n\n" + citation,
    contextBundle: [{ type: "dependencies", data: finalEvidence }], activeFile: "src/action.ts" });
  assert.ok(finalAnswer.includes(citation), "source bytes must survive every common final formatter");
  assert.equal(validateBlastSourceCitations(finalAnswer, finalEvidence).verifiedCount, 1);
  const altered = enrichChatResponseForAction({ quickAction: "blast-radius",
    content: citation.replace("  persist();", "persist();"),
    contextBundle: [{ type: "dependencies", data: finalEvidence }], activeFile: "src/action.ts" });
  assert.doesNotMatch(altered, /```/, "final publication cannot show an altered quote as reviewed source");

  for (const content of [citation, citation.replace("  persist();", "persist();"),
    citation.replace("1:6:src/action.ts", "typescript"), "The citation was removed."]) {
    let finished = false;
    let persistedCost: number | undefined;
    const turn = { history: [] as Array<{ content: string }>, artifacts: [], sessionCostUsd: 0.2,
      context: { owner: "org", repo: "project", branch: "release", fileSource: "remote" },
      sourceCitationWindows: [{ path: "src/action.ts", content: code, startLine: 1 }], sourceCitationMinimumQuotes: 1,
      id: "validated-turn", threadId: "background", modelMessage: "Original task", startedAt: Date.now() };
    const finalSession = Object.assign(Object.create(CoopChatSession.prototype), {
      threadRuns: { isStreamActive: () => true, complete: () => { finished = true; } },
      isViewingThread: () => false,
      groundAssistantCitationFences: () => { throw Error("validated final publication must not re-fetch mutable source"); },
      persistTurnThread: (completedTurn: typeof turn) => { persistedCost = completedTurn.sessionCostUsd; },
      pushThreadsList: () => undefined
    });
    const completion = finalSession.finishTurnAssistantMessage(turn, { role: "assistant", content, timestamp: 1 });
    if (content === citation) {
      await completion;
      assert.equal(turn.history[0].content, citation);
      assert.equal((turn.history[0] as { sourceCitationMode?: string }).sourceCitationMode, "explicit");
      assert.equal(finished, true);
    } else {
      await assert.rejects(completion, /altered or missing source quotes/);
      assert.equal(turn.history.length, 0, "unchecked final answers cannot enter saved history");
      assert.equal(finished, false);
    }
    assert.equal(persistedCost, 0.2, "reported model cost survives publication failure");
  }
  const savedSource = { id: "source-card", kind: "blast-radius", timestamp: 2,
    payload: { evidence: { sourceFiles: [{ path: "lib/sign.ts", branch: "release", content: "remote source" }] } } };
  const stored = { id: "background-thread", title: "Blast", artifacts: [savedSource] };
  let persistedArtifacts: unknown[] = [];
  const persistSession = Object.assign(Object.create(CoopChatSession.prototype), {
    threadStore: {
      getThreadById: (id: string) => { assert.equal(id, stored.id); return stored; },
      getActiveThread: () => { throw Error("background completion must not consult another chat's cards"); },
      setThread: (_id: string, _history: unknown, _cost: number, _title: string, artifacts: unknown[]) => {
        persistedArtifacts = artifacts;
      }
    },
    threadSyncOptions: () => ({ baseUrl: "https://api.coop-ai.dev", getToken: async () => undefined })
  });
  const backgroundTurn = { threadId: stored.id, history: [], sessionCostUsd: 0, artifacts: [],
    context: { owner: "org", repo: "signing", branch: "release" } };
  persistSession.persistTurnThread(backgroundTurn);
  assert.deepEqual(persistedArtifacts, [savedSource], "Sources saved after the turn snapshot survive background completion");
  persistSession.persistTurnThread(backgroundTurn);
  assert.equal(persistedArtifacts.length, 1, "repeated persistence must not duplicate a Sources card");
  const earlyBackgroundTurn = {
    id: "early-background", threadId: stored.id, history: [], sessionCostUsd: 0, artifacts: [],
    pendingEvidenceArtifactId: undefined as string | undefined,
    context: { owner: "org", repo: "signing", branch: "release", provider: "github", file: "lib/sign.ts" },
    contextBundle: [{ requestId: "source", type: "dependencies", fetchedAt: new Date(), data: {
      file: "lib/sign.ts", directDependents: ["api/guarded.ts"], sourceFiles: [
        { path: "lib/sign.ts", role: "target", content: "remote source", branch: "release" }
      ]
    } }]
  };
  const earlySession = Object.assign(Object.create(CoopChatSession.prototype), {
    threadRuns: { isStreamActive: () => true },
    currentContext: { owner: "other", repo: "other", file: "other.ts" },
    preferences: {},
    isViewingThread: () => false,
    threadArtifacts: [],
    threadStore: persistSession.threadStore,
    threadSyncOptions: persistSession.threadSyncOptions,
    post: () => { throw Error("background source gathering must not post to another chat"); },
    persistActiveThread: () => { throw Error("background sources belong to the frozen turn"); }
  });
  await earlySession.postEvidenceCardsFromBundle("blast-radius", undefined, earlyBackgroundTurn);
  const retained = persistedArtifacts as Array<typeof savedSource>;
  assert.equal(retained.length, 2);
  assert.equal(retained[1].id, earlyBackgroundTurn.pendingEvidenceArtifactId);
  assert.equal(retained[1].payload.evidence.sourceFiles[0].branch, "release");
  assert.equal(retained[1].payload.evidence.sourceFiles[0].content, "remote source");
  assert.equal(earlySession.threadArtifacts.length, 0, "another chat's artifacts remain untouched");
  const target = { repoId: "github:org/signing", provider: "github", owner: "org", repo: "signing", branch: "release" };
  for (const range of [undefined, { start: 2, end: 2 }]) {
    const readPaths: string[] = [];
    const sources = { "lib/sign.ts": "export function signField() {\nif (status !== PENDING) throw Error('pending');\nif (inserted) throw Error('inserted');\n}",
      "api/guarded.ts": "import { signField } from '../lib/sign';\nif (status === PENDING) signField();" };
    const turn = { startedAt: Date.now(), streamAbort: new AbortController(), contextBundle: [] as unknown[] };
    const session = Object.assign(Object.create(CoopChatSession.prototype), {
      chatTurnStartedAt: turn.startedAt,
      currentContext: { owner: "wrong", repo: "wrong", branch: "wrong" },
      options: { indexBackend: { dependents: async () => ({ dependents: ["api/guarded.ts"], source: "import-parse" }) } },
      activityTurnForRequest: () => turn,
      requestIsFileAssistant: () => false,
      repoTargetForRequest: () => target,
      recordAttachedFileReads: (payload: { files: Array<{ path: string }> }, actualTurn: unknown) => {
        assert.equal(actualTurn, turn);
        readPaths.push(payload.files[0].path);
      },
      logAttachmentDiagnostic: () => undefined,
      indexedRepoWorkspace: () => ({ readFile: async (scope: unknown, path: keyof typeof sources) => {
        assert.deepEqual(scope, target);
        return { path, content: sources[path], origin: "remote", repoId: target.repoId };
      } }),
      buildBaseContextResult: () => { throw Error("must not spend the caller-read budget on secondary engine enrichment"); },
      reconcileBlastDependentsWithVerifiedSearch: () => { throw Error("must not repeat source gather after a job"); }
    });
    const result = await session.fetchContextRequest({ id: "blast-test", type: "dependencies",
      params: { quickAction: "blast-radius", file: "lib/sign.ts", lines: range },
      intent: { context: { queryText: "Which callers could this status guard change affect?" } } });
    assert.deepEqual(readPaths.sort(), ["api/guarded.ts", "lib/sign.ts"]);
    turn.contextBundle = [result];
    await session.applyBlastRadiusJobResultToBundle("blast-radius", turn);
    const evidence = blastRadiusFromBundle(turn.contextBundle)!;
    assert.equal(evidence.sourceFiles?.length, 2);
    const prompt = buildBlastRadiusSynthesisUserPrompt({ evidence, file: "lib/sign.ts" });
    assert.match(prompt, /3 \| if \(inserted\) throw/);
    assert.match(prompt, /2 \| if \(status === PENDING\) signField/);
    assert.doesNotMatch(prompt, /wrong/);
  }
  console.log("blastRadiusSourceEvidence hot path: whole-file/range remote reads, turn-owned activity, retained caller bodies, and job bypass passed");
}
void run().catch(error => { console.error(error); process.exit(1); });
