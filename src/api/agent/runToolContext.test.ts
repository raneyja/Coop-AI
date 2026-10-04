import assert from "node:assert/strict";
import { createRunToolContext } from "./runToolContext";
import type { AgentToolContext } from "./agentToolContext";

async function main() {
  const calls: Array<{ repoId?: string; branch?: string }> = [];
  const events: Record<string, unknown>[] = [];
  const ctx = {
    indexBackend: {} as AgentToolContext["indexBackend"],
    resolveAbsolutePath: () => undefined,
    readRemoteFile: async ({ repoId, target, path }) => {
      calls.push({ repoId, branch: target?.branch });
      return { path, content: target?.branch === "preview" ? "preview validation" : "default validation" };
    },
    findFiles: async ({ repoId, target }) => {
      calls.push({ repoId, branch: target?.branch });
      return ["server/validation.py"];
    },
    searchCodeHost: async () => { throw new Error("provider unavailable"); }
  } as AgentToolContext;
  const target = { repoId: "github:org/repo", branch: "preview" };
  const run = createRunToolContext(ctx, target, (event) => events.push(event));
  target.branch = "main";
  target.repoId = "github:org/other";
  const file = await run.readRemoteFile!({ path: "server/validation.py", repoId: "model-chosen-repo" });
  await run.findFiles!({ query: "validation" });
  assert.equal(file?.content, "preview validation");
  assert.deepEqual(calls, [{ repoId: "github:org/repo", branch: "preview" }, { repoId: "github:org/repo", branch: "preview" }]);
  await Promise.all([
    run.readRemoteFile!({ path: "server/validation.py" }),
    run.readRemoteFile!({ path: "/server/validation.py" })
  ]);
  assert.equal(calls.length, 2, "repeated windows must share the full remote body");
  const otherRun = createRunToolContext(ctx, { repoId: "github:org/repo", branch: "main" });
  const otherFile = await otherRun.readRemoteFile!({ path: "server/validation.py" });
  assert.equal(otherFile?.content, "default validation", "another turn must not reuse the preview body");
  await assert.rejects(run.searchCodeHost!({ query: "validation" }), /provider unavailable/);
  assert.equal(events.at(-1)?.outcome, "error");
  assert.ok(events.every((event) => event.resolvedBranch === "preview"));
  assert.ok(events.filter((event) => event.stage === "remote-read" || event.stage === "filename-search").every((event) => typeof event.elapsedMs === "number" && Number(event.elapsedMs) >= 0));
  assert.ok(events.some((event) => event.stage === "filename-search-start" && event.query === "validation"));
  assert.ok(!JSON.stringify(events).includes("preview validation"));
  let indexCalls = 0;
  const budgetCtx = {
    ...ctx,
    gatherStartedAt: Date.now(),
    indexBackend: {
      isEnabledForRepo: async () => true,
      search: async () => { indexCalls++; return { source: "fallback", hits: [], symbols: [], stale: false }; }
    } as unknown as AgentToolContext["indexBackend"]
  };
  const budgetRun = createRunToolContext(budgetCtx, { repoId: "github:org/repo", branch: "preview" });
  const verifiedBeforeHandoff = await budgetRun.readRemoteFile!({ path: "server/validation.py" });
  budgetCtx.gatherStartedAt = Date.now() - 15_001;
  assert.deepEqual(await budgetRun.readRemoteFile!({ path: "server/validation.py" }), verifiedBeforeHandoff,
    "Verified bodies survive the gather handoff");
  const partial = await budgetRun.indexBackend.search("github:org/repo", "validation");
  assert.equal(indexCalls, 0, "No new index work after gather handoff");
  assert.deepEqual(partial.hits, []);
  assert.equal(partial.stale, true, "Unavailable index work cannot be represented as a fresh search");
  console.log("runToolContext target isolation and diagnostics passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
