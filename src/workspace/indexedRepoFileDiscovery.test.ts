import assert from "node:assert/strict";
import { IndexedRepoWorkspace } from "./IndexedRepoWorkspace";
import type { RepoInventoryDeps } from "./repoInventorySources";
import { handleGraphHttp } from "../webhooks/graphHttp";
import { GraphQueryApi } from "../api/graphQuery";
import { GraphCache } from "../cache/graphCache";
import { blankRepositoryGraph } from "../cache/graphCache";
import { rankSearchHits } from "../api/agent/searchQuery";
import { CoopBackendClient } from "../api/CoopBackendClient";

async function main(): Promise<void> {
  const target = { repoId: "github:org/repo", branch: "main" };
  let map: unknown = {
    repoId: target.repoId, indexedBranch: "main", indexedCommit: "abc", stale: false,
    data: [{ path: "apps/web/parent.tsx" }, { path: "apps/api/parent.py" }, { path: "apps/api/user_activation.py" }]
  };
  const calls: unknown[][] = [];
  let explorerSearches: string[] = [];
  let explorerLimits: number[] = [];
  let explorerOptions: Array<{ excludeClientUi?: boolean }> = [];
  const diagnostics: Array<Record<string, unknown>> = [];
  const deps = {
    apiBaseUrl: "https://api.coop-ai.dev",
    api: { fetchIndexedRepoFileMap: async (...args: unknown[]) => { calls.push(args); return map; } },
    codeHostRouter: {
      searchRepositoryFiles: async (query: string, _coords: unknown, limit?: number, options?: { excludeClientUi?: boolean }) => {
        explorerSearches.push(query);
        explorerLimits.push(limit ?? 0);
        explorerOptions.push(options ?? {});
        if (query === "sign") {
          return [{ path: "packages/trpc/server/envelope-router/sign-envelope-field.ts", name: "sign-envelope-field.ts" }];
        }
        return [{ path: "apps/api/parent.py", name: "parent.py" }];
      }
    }
  } as unknown as RepoInventoryDeps;
  const workspace = new IndexedRepoWorkspace(deps);
  assert.deepEqual(await workspace.findFiles(target, "parent.", {
    limit: 1, acceptPath: (path) => !path.startsWith("apps/web/")
  }), [{ path: "apps/api/parent.py", name: "parent.py" }]);
  assert.deepEqual(calls[0].slice(0, 3), ["https://api.coop-ai.dev", target.repoId, "main"]);
  assert.deepEqual(await workspace.findFiles(target, "absent_filename"), []);
  assert.equal(calls.length, 1, "repeated criteria share one map fetch");
  assert.deepEqual(
    await workspace.findFiles(target, "sign"),
    [{ path: "packages/trpc/server/envelope-router/sign-envelope-field.ts", name: "sign-envelope-field.ts" }],
    "a valid but partial map falls through to live filename search when it has no match"
  );
  assert.ok(explorerLimits.at(-1)! >= 100, "fallback discovery must return a wide pool before task ranking");
  assert.equal(explorerOptions.at(-1)?.excludeClientUi, undefined, "ordinary explorer search does not force the backend tree fallback");
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
  const partialSigningMap = {
    repoId: target.repoId, indexedBranch: "main", indexedCommit: "abc", stale: false,
    data: [
      { path: "packages/trpc/server/envelope-router/signing-status-envelope.types.ts" },
      ...Array.from({ length: 24 }, (_, index) => ({ path: `apps/client/sign-${index}.tsx` }))
    ]
  };
  const partialDeps = {
    ...deps,
    api: { fetchIndexedRepoFileMap: async () => partialSigningMap }
  } as unknown as RepoInventoryDeps;
  assert.deepEqual(await new IndexedRepoWorkspace(partialDeps).findFiles(target, "sign", {
    limit: 1,
    augmentFromCodeHost: true,
    excludeClientUi: true,
    rankPaths: (paths) => rankSearchHits(paths.map((fileName) => ({ fileName, lineNumber: 1, score: 0.4 })), signingTask).map((hit) => hit.fileName)
  }), [{ path: "packages/trpc/server/envelope-router/sign-envelope-field.ts", name: "sign-envelope-field.ts" }], "partial non-empty maps are augmented before task ranking");
  assert.equal(explorerOptions.at(-1)?.excludeClientUi, true, "reject filename discovery asks the cloud search to widen through the tree");
  calls.pop();
  assert.equal(await workspace.findFiles({ repoId: target.repoId }, "parent"), undefined);
  assert.equal(calls.length, 1, "missing frozen branch does not fetch a map");
  await workspace.findFiles({ ...target, branch: "other" }, "parent");
  assert.equal(calls.length, 2, "another frozen branch has a separate map request");
  map = { ...(map as object), indexedBranch: "other" };
  assert.deepEqual(
    await new IndexedRepoWorkspace(deps).findFiles(target, "parent", { onDiagnostic: (event) => diagnostics.push(event) }),
    [{ path: "apps/api/parent.py", name: "parent.py" }],
    "branch metadata mismatch falls back to the selected branch's code-host search"
  );
  map = { ...(map as object), indexedBranch: undefined };
  const legacySigningMap = { repoId: target.repoId, stale: false, data: [
    { path: "apps/web/sign-in.tsx" }, { path: signingPath }
  ] };
  const client = Object.assign(Object.create(CoopBackendClient.prototype), {
    http: { get: async () => ({status: 200, data: legacySigningMap}) },
    authHeaders: async () => ({})
  });
  assert.deepEqual(await client.fetchIndexedRepoFileMap(deps.apiBaseUrl, target.repoId, "main"), legacySigningMap,
    "legacy API map paths must reach discovery instead of being discarded before the workspace can use them");
  const searchesBeforeLeads = explorerSearches.length;
  const leadDiagnostics: Array<Record<string, unknown>> = [];
  assert.deepEqual(await new IndexedRepoWorkspace({ ...deps, api: {fetchIndexedRepoFileMap: async () => legacySigningMap} } as unknown as RepoInventoryDeps)
    .findFiles(target, "sign", { limit: 1, excludeClientUi: true,
      acceptPath: path => !path.startsWith("apps/web/"),
      rankPaths: paths => rankSearchHits(paths.map(fileName => ({fileName, lineNumber: 1, score: 0.4})), signingTask).map(hit => hit.fileName),
      onDiagnostic: event => leadDiagnostics.push(event)
    }), [{path: signingPath, name: "sign-field-with-token.ts"}], "legacy map leads enable selected-ref body verification without a slow tree walk");
  assert.equal(explorerSearches.length, searchesBeforeLeads);
  assert.equal(leadDiagnostics[0]?.provenance, "unverified-ref-paths");
  assert.equal(leadDiagnostics[0]?.requestedBranch, "main");
  assert.deepEqual(
    await new IndexedRepoWorkspace(deps).findFiles(target, "parent", { onDiagnostic: (event) => diagnostics.push(event) }),
    [{ path: "apps/api/parent.py", name: "parent.py" }],
    "a map with file data but no branch metadata still gets a branch-bound fallback"
  );
  map = { ...(map as object), indexedBranch: "main", repoId: "github:foreign/repo" };
  assert.deepEqual(
    await new IndexedRepoWorkspace(deps).findFiles(target, "parent"),
    [{ path: "apps/api/parent.py", name: "parent.py" }],
    "repository identity mismatch falls back without widening the requested target"
  );
  map = { ...(map as object), repoId: target.repoId, stale: true };
  assert.deepEqual(
    await new IndexedRepoWorkspace(deps).findFiles(target, "parent"),
    [{ path: "apps/api/parent.py", name: "parent.py" }],
    "stale index maps fall back to branch-bound code-host filename search"
  );
  assert.equal(explorerSearches.at(-1), "parent");
  assert.deepEqual(
    diagnostics.map((event) => event.fallbackReason),
    ["response_branch_mismatch", "response_branch_metadata_missing"],
    "branch contract failures identify the exact safe fallback reason"
  );
  assert.equal(diagnostics[1]?.requestedRepoId, target.repoId);
  assert.equal(diagnostics[1]?.requestedBranch, target.branch);
  assert.equal(diagnostics[1]?.responseIndexedBranch, undefined);
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
