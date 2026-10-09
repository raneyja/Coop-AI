import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createAgentOrchestrator, type AgentRunOptions } from "./AgentOrchestrator";
import type { AgentStreamAnswerInput } from "./agentTypes";
import type { IndexBackend } from "../../indexing/indexBackend";
import { agentTurnAction } from "../../chat/agentRouting";
import { planChatFrontDoor } from "../../chat/intentPlanner/frontDoor";
import { openFileOwnsExplainAsk } from "../../chat/plainChatExplain";
import { isDirectRepoFileQuestion } from "./directRepoFileQuestion";

const target = { repoId: "github:fixture/remote", owner: "fixture", repo: "remote", branch: "preview" };
const bodies = { "src/alpha.ts": "export const alpha = 17;", "src/beta.ts": "export const beta = 23;" };
let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn(); passed++; console.log(`  ✓ ${name}`);
}
async function exercise(query: string, options: AgentRunOptions = {}) {
  let plans = 0;
  const reads: string[] = [];
  let writer: AgentStreamAnswerInput | undefined;
  const agent = createAgentOrchestrator({
    indexBackend: { isEnabledForRepo: async () => true, search: async () => {
      throw new Error("direct questions must not search");
    } } as unknown as IndexBackend,
    resolveAbsolutePath: () => { throw new Error("no local repository intelligence"); },
    resolveRepoTarget: async () => target,
    readRemoteFile: async ({path, target: locked}) => {
      assert.deepEqual(locked, target); reads.push(path);
      const content = bodies[path as keyof typeof bodies];
      return content === undefined ? undefined : { path, content, repoId: target.repoId, branch: target.branch };
    }
  });
  const result = await agent.run({repoId: target.repoId, message: query, action: "understand"}, {
    repoTarget: target,
    planTurn: async () => { plans++; return '{"done":true}'; },
    streamAnswer: async input => { writer = input; return "source-backed answer"; },
    ...options
  });
  return { result, writer, plans, reads };
}

async function run() {
  await test("direct file question avoids both intent-model and tool-plan round trips", async () => {
    const query = "Using only the selected repository, read /src/alpha.ts and /src/beta.ts. Quote their constants.";
    let intentCalls = 0;
    const plan = await planChatFrontDoor({ message: query, connectedTools: [], useRepo: "fixture/remote", constraint: {kind: "none"} }, {
      complete: async () => { intentCalls++; return '{"mode":"plain"}'; }
    });
    assert.equal(intentCalls, 0);
    assert.equal(agentTurnAction({ query, hasQuickAction: false, intentPlan: plan }), "understand");
    const result = await exercise(query, {capturedAttachment: {...target, files: [{path: "unrelated.ts", content: "unrelated-chip-body"}]}});
    assert.equal(result.plans, 0);
    assert.equal(result.writer?.directFileAnswer, true);
    assert.deepEqual(result.reads, ["src/alpha.ts", "src/beta.ts"]);
    assert.equal(result.writer?.attachedFiles, undefined);
    for (const body of Object.values(bodies)) assert.equal(JSON.stringify(result.writer?.conversation).split(body).length - 1, 1);
    assert.doesNotMatch(JSON.stringify(result.writer), /unrelated-chip-body/);
  });

  await test("unavailable direct source is a resolved outcome without another planning round", async () => {
    const result = await exercise("Read /src/alpha.ts and quote /src/missing.ts.");
    assert.equal(result.plans, 0);
    assert.deepEqual(result.writer?.requestedFiles?.map(file => file.status), ["read", "unavailable"]);
    assert.ok(result.writer?.conversation.some(message => message.content.includes(bodies["src/alpha.ts"])));
  });

  for (const query of [
    "Read /src/alpha.ts and find all callers.",
    "Read /src/alpha.ts and explain its commit history.",
    "Read /src/alpha.ts then modify the implementation.",
    "Read /src/alpha.ts and add a comment.",
    "Read /src/alpha.ts and identify every module affected by its exports.",
    "Read /src/alpha.ts and explain repository-wide security impact.",
    "Find the API rejection for the submitted field in /src/alpha.ts."
  ]) await test(`broader investigation keeps discovery: ${query}`, async () => {
    assert.equal(isDirectRepoFileQuestion(query), false);
    if (!query.includes("API rejection")) assert.ok((await exercise(query)).plans > 0, "broader asks must reach the tool planner");
  });

  const require = createRequire(__filename);
  require("../../../scripts/vscode-test-stub.cjs");
  const { CoopChatSession } = await import("../../chat/CoopChatSession");
  const requests: Array<{message: string; enableThinking?: boolean; history?: Array<{content: string}>}> = [];
  const turn = { id: "fixture-turn", threadId: "fixture-thread", startedAt: Date.now(), context: target };
  const session = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: {owner: "wrong", repo: "other", branch: "main"},
    preferences: { maxTokens: 1000 },
    activityTurnForRequest: () => undefined,
    appendLiveToolActivityLine: () => {},
    indexedRepoWorkspace: () => ({
      getIdentity: () => target,
      getInventory: async (locked: unknown) => { assert.deepEqual(locked, target); return {source: "index-stats", branch: "preview", fileCount: 4616}; },
      getTreeOverview: async (locked: unknown) => { assert.deepEqual(locked, target); return {branch: "preview", topLevelDirs: ["src", "tests"], topLevelFiles: ["README.md"]}; }
    }),
    buildProjectInstructionsBlock: async () => undefined,
    options: {api: {streamChat: async (request: typeof requests[number]) => {
      requests.push(request); return {message: {content: "source-backed answer"}, finishReason: "stop"};
    }}}
  });

  for (const [question, expectedTag] of [
    ["How many files are in this repository? Then read /src/alpha.ts and quote its constant.", "<repo_inventory>"],
    ["List top-level directories in this repository. Then read /src/alpha.ts and quote its constant.", "<repo_tree_overview>"],
    ["How many files are in this repository? List top-level directories, then read /src/alpha.ts and quote its constant.", "<repo_inventory>"]
  ]) await test(`compound facts and sources reach the actual writer: ${expectedTag}`, async () => {
    assert.equal(agentTurnAction({query: question, hasQuickAction: false}), "understand");
    assert.equal(openFileOwnsExplainAsk(`Explain /src/alpha.ts and ${question}`, "src/alpha.ts"), false);
    const result = await exercise(question, {
      loadRepoFacts: async locked => {
        const gathered = await session.enrichChatContextWithRepoInventory({
          id: "facts", type: "chat_context", params: {gatherStartedAt: Date.now()}, intent: {context: {queryText: question}}
        }, {type: "chat_context", data: {}}, locked);
        return gathered.data;
      },
      streamAnswer: async input => session.streamAgentAnswer(input, {provider: "openai", model: "fixture"}, "chat", () => {}, undefined, turn.threadId, turn)
    });
    assert.equal(result.plans, 0);
    assert.deepEqual(result.reads, ["src/alpha.ts"]);
    const request = requests.at(-1)!;
    assert.ok(request.message.includes(expectedTag));
    if (expectedTag === "<repo_inventory>") assert.match(request.message, /4616/);
    else assert.match(request.message, /directories: src, tests/);
    if (question.includes("directories")) assert.ok(request.message.includes("<repo_tree_overview>"));
    assert.equal(request.enableThinking, false);
    assert.ok(request.history?.some(entry => entry.content.includes(bodies["src/alpha.ts"])));
  });

  for (const failure of ["inventory", "layout", "wrong-inventory-branch", "wrong-layout-branch"] as const) {
    await test(`independent fact outcomes survive ${failure}`, async () => {
      const query = "How many files are in the repository? List top-level directories, then read /src/alpha.ts.";
      const workspace = session.indexedRepoWorkspace();
      const partialSession = Object.assign(Object.create(CoopChatSession.prototype), session, {
        indexedRepoWorkspace: () => ({...workspace,
          getInventory: async () => {
            if (failure === "inventory") throw new Error("inventory unavailable");
            return {source: "index-stats", fileCount: 4616, branch: failure === "wrong-inventory-branch" ? "other" : "preview"};
          },
          getTreeOverview: async () => {
            if (failure === "layout") throw new Error("layout unavailable");
            return {topLevelDirs: ["src"], topLevelFiles: [], branch: failure === "wrong-layout-branch" ? "other" : "preview"};
          }
        })
      });
      const result = await exercise(query, {loadRepoFacts: async locked => {
        const gathered = await partialSession.enrichChatContextWithRepoInventory({
          id: "facts", type: "chat_context", params: {gatherStartedAt: Date.now()}, intent: {context: {queryText: query}}
        }, {type: "chat_context", data: {}}, locked);
        return gathered.data;
      }});
      assert.deepEqual(result.reads, ["src/alpha.ts"]);
      assert.ok(result.writer?.conversation.some(entry => entry.content.includes(bodies["src/alpha.ts"])));
      const inventory = result.writer?.repoFacts?.repoInventory as {source: string; fileCount?: number};
      if (failure.includes("inventory")) {
        assert.equal(inventory.source, "unavailable");
        assert.equal(inventory.fileCount, undefined);
        assert.ok(result.writer?.repoFacts?.treeOverview);
      } else {
        assert.equal(inventory.fileCount, 4616);
        assert.equal(result.writer?.repoFacts?.treeOverview, undefined);
        assert.match(String(result.writer?.repoFacts?.packageBoundaryNote), /unavailable|could not be verified/);
      }
    });
  }

  for (const pendingFact of ["inventory", "layout"] as const) await test(`budget handoff preserves the fulfilled sibling of pending ${pendingFact}`, async () => {
    const query = "How many files are in the repository? List top-level directories, then read /src/alpha.ts.";
    const startedAt = Date.now() - 8850;
    const workspace = session.indexedRepoWorkspace();
    const partialSession = Object.assign(Object.create(CoopChatSession.prototype), session, {
      indexedRepoWorkspace: () => ({...workspace,
        getInventory: pendingFact === "inventory" ? async () => new Promise(() => {}) : workspace.getInventory,
        getTreeOverview: pendingFact === "layout" ? async () => new Promise(() => {}) : workspace.getTreeOverview
      })
    });
    const result = await exercise(query, {startedAt, loadRepoFacts: async (locked, onProgress) => {
      const gathered = await partialSession.enrichChatContextWithRepoInventory({
        id: "facts", type: "chat_context", params: {gatherStartedAt: startedAt}, intent: {context: {queryText: query}}
      }, {type: "chat_context", data: {}}, locked, undefined, onProgress);
      return gathered.data;
    }});
    assert.deepEqual(result.reads, ["src/alpha.ts"]);
    if (pendingFact === "layout") {
      assert.equal((result.writer?.repoFacts?.repoInventory as {fileCount: number}).fileCount, 4616);
      assert.equal(result.writer?.repoFacts?.treeOverview, undefined);
    } else {
      assert.equal((result.writer?.repoFacts?.repoInventory as {source: string}).source, "unavailable");
      assert.ok(result.writer?.repoFacts?.treeOverview);
    }
  });

  await test("late fact progress cannot mutate the answer's retained snapshot", async () => {
    let progress!: (facts: Record<string, unknown>) => void;
    const result = await exercise("How many files are in the repository? Read /src/alpha.ts.", {
      startedAt: Date.now() - 8900,
      loadRepoFacts: async (_target, onProgress) => {
        progress = onProgress!;
        progress({repoInventory: {source: "index-stats", fileCount: 4616}});
        return new Promise(() => {});
      }
    });
    progress({repoInventory: {source: "index-stats", fileCount: 9999}});
    assert.equal((result.writer?.repoFacts?.repoInventory as {fileCount: number}).fileCount, 4616);
  });

  await test("slow inventory cannot hold up supported source or turn exhaustion into an abort", async () => {
    const result = await exercise("How many files are in the repository? Read /src/alpha.ts.", {
      startedAt: Date.now() - 8950,
      loadRepoFacts: async () => new Promise(() => {})
    });
    assert.equal(result.writer?.repoFacts?.repoInventory && (result.writer.repoFacts.repoInventory as {source: string}).source, "unavailable");
    assert.deepEqual(result.reads, ["src/alpha.ts"]);
    assert.ok(result.writer?.conversation.some(entry => entry.content.includes(bodies["src/alpha.ts"])));
  });

  await test("user Stop while waiting for inventory prevents answer synthesis", async () => {
    const controller = new AbortController();
    let beginFacts!: () => void;
    const started = new Promise<void>(resolve => {beginFacts = resolve;});
    const pending = exercise("How many files are in the repository? Read /src/alpha.ts.", {
      signal: controller.signal, startedAt: Date.now(),
      loadRepoFacts: async () => {beginFacts(); return new Promise(() => {});}
    });
    await started; controller.abort();
    const result = await pending;
    assert.equal(result.writer, undefined);
    assert.equal(result.result.answer, undefined);
  });
  console.log(`\ndirectRepoFileQuestion: ${passed}/${passed} tests passed`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
