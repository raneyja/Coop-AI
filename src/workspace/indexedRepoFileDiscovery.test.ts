import assert from "node:assert/strict";
import { IndexedRepoWorkspace } from "./IndexedRepoWorkspace";
import type { RepoInventoryDeps } from "./repoInventorySources";
import { handleGraphHttp } from "../webhooks/graphHttp";
import { GraphQueryApi } from "../api/graphQuery";
import { GraphCache } from "../cache/graphCache";
import { blankRepositoryGraph } from "../cache/graphCache";
import { rankSearchHits } from "../api/agent/searchQuery";

async function main(): Promise<void> {
  const target = { repoId: "github:org/repo", branch: "main" };
  let map: unknown = {
    repoId: target.repoId, indexedBranch: "main", indexedCommit: "abc", stale: false,
    data: [{ path: "apps/web/parent.tsx" }, { path: "apps/api/parent.py" }, { path: "apps/api/user_activation.py" }]
  };
  const calls: unknown[][] = [];
  const deps = {
    apiBaseUrl: "https://api.coop-ai.dev",
    api: { fetchIndexedRepoFileMap: async (...args: unknown[]) => { calls.push(args); return map; } },
    codeHostRouter: {}
  } as unknown as RepoInventoryDeps;
  const workspace = new IndexedRepoWorkspace(deps);
  assert.deepEqual(await workspace.findFiles(target, "parent.", {
    limit: 1, acceptPath: (path) => !path.startsWith("apps/web/")
  }), [{ path: "apps/api/parent.py", name: "parent.py" }]);
  assert.deepEqual(calls[0].slice(0, 3), ["https://api.coop-ai.dev", target.repoId, "main"]);
  assert.deepEqual(await workspace.findFiles(target, "absent_filename"), []);
  assert.equal(calls.length, 1, "repeated criteria share one map fetch");
  const signingPath = "packages/lib/server-only/field/sign-field-with-token.ts";
  map = { ...(map as object), data: [
    ...Array.from({ length: 120 }, (_, index) => ({ path: `apps/client/sign-${index}.tsx` })),
    { path: "packages/auth/server/routes/sign-out.ts" },
    { path: "packages/enterprise/server-only/signing/cookies/blocking-error-cookie.ts" },
    { path: "packages/enterprise/server-only/signing/prepare-recipient-signing.ts" },
    { path: "packages/lib/server-only/signature-level/assert-compatible-dictate-next-signer.ts" },
    { path: signingPath }
  ] };
  const signingTask = "A signer gets an error that the document must be pending for signing. Where does the server reject this request, and what status check enforces it?";
  assert.deepEqual(await new IndexedRepoWorkspace(deps).findFiles(target, "sign", {
    limit: 1,
    rankPaths: (paths) => rankSearchHits(paths.map((fileName) => ({ fileName, lineNumber: 1, score: 0.4 })), signingTask).map((hit) => hit.fileName)
  }), [{ path: signingPath, name: "sign-field-with-token.ts" }], "task relevance ranks the complete matching map before the result cap");
  calls.pop();
  assert.equal(await workspace.findFiles({ repoId: target.repoId }, "parent"), undefined);
  assert.equal(calls.length, 1, "missing frozen branch does not fetch a map");
  await workspace.findFiles({ ...target, branch: "other" }, "parent");
  assert.equal(calls.length, 2, "another frozen branch has a separate map request");
  map = { ...(map as object), indexedBranch: "other" };
  assert.equal(await new IndexedRepoWorkspace(deps).findFiles(target, "parent"), undefined);
  map = { ...(map as object), indexedBranch: undefined };
  assert.equal(await new IndexedRepoWorkspace(deps).findFiles(target, "parent"), undefined);
  map = { ...(map as object), indexedBranch: "main", repoId: "github:foreign/repo" };
  assert.equal(await new IndexedRepoWorkspace(deps).findFiles(target, "parent"), undefined);
  map = { ...(map as object), repoId: target.repoId, stale: true };
  assert.equal(await new IndexedRepoWorkspace(deps).findFiles(target, "parent"), undefined);
  const cache = new GraphCache();
  const graph = blankRepositoryGraph({ repoId: target.repoId, owner: "org", repo: "repo" });
  graph.metadata.indexedBranch = "main";
  graph.metadata.indexedCommit = "abc";
  graph.fileTree = [{ path: "apps/api/parent.py", size: 1, lastModified: new Date(), lastAuthor: "test", sha: "abc" }];
  cache.setGraph("org-id", graph);
  assert.equal(cache.getFileTree("org-id", target.repoId)?.indexedBranch, "main");
  assert.equal(cache.getFileTree("org-id", target.repoId)?.indexedCommit, "abc");
  assert.equal(cache.getFileTree("foreign-org", target.repoId), undefined);
  const pool = { query: async () => ({ rows: [{ repo_id: target.repoId }] }) };
  const route = (branch: string) => handleGraphHttp({
    pathname: `/graph/${encodeURIComponent(target.repoId)}/tree`,
    searchParams: new URLSearchParams({ branch }), orgId: "org-id", pool: pool as never,
    cache, graphQuery: new GraphQueryApi({ cache })
  });
  assert.equal((await route("main")).statusCode, 200);
  const mismatch = await route("other");
  assert.equal(mismatch.statusCode, 404);
  assert.equal(JSON.stringify(mismatch.body).includes("parent.py"), false);
  graph.metadata.indexedBranch = undefined;
  cache.setGraph("org-id", graph);
  assert.equal((await route("main")).statusCode, 404);
  assert.equal((await route("")).statusCode, 200, "Legacy unqualified tree consumers retain their existing API contract");
  console.log("indexed file discovery: branch, identity, stale, missing and pre-cap filtering checks passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
