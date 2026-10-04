import assert from "node:assert/strict";
import { CoopChatSession } from "./CoopChatSession";
import { knowledgeGapsFromBundle } from "../context/contextBundleEvidence";

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
  console.log("knowledgeGapsNamedFocus: 4/4 cold named-target enrichment cases passed");
}

void run().catch((error) => { console.error(error); process.exit(1); });
