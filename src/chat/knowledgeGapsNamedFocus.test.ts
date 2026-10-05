import assert from "node:assert/strict";
import { CoopChatSession } from "./CoopChatSession";
import { knowledgeGapsFromBundle } from "../context/contextBundleEvidence";
import { importOnlyNamedBlastAnswer } from "../prompts/blastRadiusSynthesis";

async function run(): Promise<void> {
  const target = { repoId: "github:org/fixture", provider: "github", owner: "org", repo: "fixture", branch: "renamed" };
  for (const fromJobs of [true, false]) {
    for (const available of [true, false]) {
      const session = Object.assign(Object.create(CoopChatSession.prototype), {
        chatTurnStartedAt: Date.now(),
        currentContext: { file: "src/unrelated.ts", branch: "main" },
        preferences: { defaultCodeHost: "github" },
        repoTargetForRequest: () => target,
        indexedRepoWorkspace: () => ({ readFile: async (actualTarget: unknown, path: string) => {
          assert.deepEqual(actualTarget, target);
          assert.equal(path, "src/mathRenamed.ts");
          return available ? { path, repoId: target.repoId, origin: "remote", content: "export const positiveSum = () => 0;" } : undefined;
        } })
      });
      const result = await session.enrichKnowledgeGapsWithFocusSearch({
        params: { intentPlan: { jobs: fromJobs ? [{ capability: "locate", terms: ["src/mathRenamed.ts"] }] : [] } },
        intent: { context: { queryText: fromJobs ? "Identify concrete supported gaps for positiveSum. Label unknowns." : "Identify concrete supported gaps for src/mathRenamed.ts. Label unknowns." } }
      }, { requestId: "test", type: "knowledge_gaps", data: {}, fetchedAt: new Date() });
      assert.equal(result.data.file, "src/mathRenamed.ts");
      assert.deepEqual(result.data.focusSearchPaths, ["src/mathRenamed.ts"]);
      assert.equal(result.data.focusFiles.length, available ? 1 : 0);
      if (available) assert.equal(result.data.focusFiles[0].startLine, 1);
      const evidence = knowledgeGapsFromBundle([result]);
      assert.equal(evidence?.file, "src/mathRenamed.ts");
      assert.equal(evidence?.focusFiles?.length, available ? 1 : 0);
    }
  }
  let reads = 0;
  const earlySession = Object.assign(Object.create(CoopChatSession.prototype), {
    chatTurnStartedAt: Date.now(),
    currentContext: { file: "src/unrelated.ts", branch: "main" },
    preferences: { defaultCodeHost: "github" },
    repoTargetForRequest: () => target,
    requestIsFileAssistant: () => false,
    indexedRepoWorkspace: () => ({ readFile: async (actualTarget: unknown, path: string) => {
      reads++;
      assert.deepEqual(actualTarget, target);
      assert.equal(path, "src/mathRenamed.ts");
      return { path, repoId: target.repoId, origin: "remote", content: "export const positiveSum = () => 0;" };
    } }),
    buildBaseContextResult: async () => {
      assert.equal(reads, 1, "named remote read must start before the scan");
      earlySession.chatTurnStartedAt = Date.now() - 60_000;
      return { requestId: "early", type: "knowledge_gaps", data: {}, fetchedAt: new Date() };
    },
    enrichWithIndexedWorkspace: async (_request: unknown, result: unknown) => result
  });
  const earlyResult = await earlySession.fetchContextRequest({
    type: "knowledge_gaps",
    params: { quickAction: "knowledge-gaps", intentPlan: { jobs: [] } },
    intent: { context: { queryText: "Identify supported gaps for positiveSum in src/mathRenamed.ts" } }
  });
  assert.equal(reads, 1, "completed early read must not be repeated after the scan");
  assert.equal(earlyResult.data.focusFiles[0].path, "src/mathRenamed.ts");
  assert.equal(earlyResult.data.focusFiles[0].startLine, 1);
  assert.equal(knowledgeGapsFromBundle([earlyResult])?.focusFiles?.length, 1);
  const blastEvidence = { file: "src/mathRenamed.ts", namedAskSymbols: ["positiveSum"], directDependents: ["src/caller.ts"], graphMeta: { source: "import-parse" } };
  const completed: Array<{ turn: unknown; message: { content: string; relatedArtifactId?: string } }> = [];
  const cleared: string[] = [];
  const blastSession = Object.assign(Object.create(CoopChatSession.prototype), {
    pendingEvidenceArtifactId: "evidence-1",
    isViewingThread: () => true,
    clearIntentFeedback: (id: string) => cleared.push(id),
    finishTurnAssistantMessage: async (turn: unknown, message: { content: string; relatedArtifactId?: string }) => completed.push({ turn, message })
  });
  const blastTurn = { threadId: "blast-thread", startedAt: Date.now(), pendingEvidenceArtifactId: "evidence-1" };
  assert.equal(await blastSession.finishImportOnlyBlastTurn(blastTurn, blastEvidence, () => false), true);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].turn, blastTurn);
  assert.equal(completed[0].message.content, importOnlyNamedBlastAnswer(blastEvidence));
  assert.equal(completed[0].message.relatedArtifactId, "evidence-1");
  assert.equal(blastTurn.pendingEvidenceArtifactId, undefined);
  assert.equal(blastSession.pendingEvidenceArtifactId, undefined);
  assert.deepEqual(cleared, ["blast-thread"]);
  assert.equal(await blastSession.finishImportOnlyBlastTurn(blastTurn, blastEvidence, () => true), true);
  assert.equal(completed.length, 1, "Stop must not finish a cancelled turn");
  assert.equal(await blastSession.finishImportOnlyBlastTurn(blastTurn, { ...blastEvidence,
    dependentDetails: [{ path: "src/caller.ts", depth: 1, source: "import-parse", strength: "strong" }]
  }, () => false), false, "verified named calls must retain normal model synthesis");
  console.log("knowledgeGapsNamedFocus: 5/5 cold named-target and scan-budget cases passed");
  console.log("import-only Blast session: finish/artifact, Stop, and verified-evidence bypass passed");
}

void run().catch((error) => { console.error(error); process.exit(1); });
