import assert from "node:assert/strict";
import { legacyIndexedMapProvenance } from "./indexedMapProvenance";
import type { StoredRepoStats } from "./repoStatsStore";
import { GraphCache, blankRepositoryGraph } from "../cache/graphCache";
import { GraphQueryApi } from "../api/graphQuery";
import { handleGraphHttp } from "../webhooks/graphHttp";

const commit = "a".repeat(40);
const files = [{ path: "server/record.py", sha: commit }, { path: "server/model.py", sha: commit }];
const stats: StoredRepoStats = { branch: "preview", headCommit: commit, fileCount: 2,
  lineCount: 20, byteCount: 50, languages: ["python"], indexedAt: new Date().toISOString() };
assert.deepEqual(legacyIndexedMapProvenance(files, stats, "preview"), { indexedBranch: "preview", indexedCommit: commit });
assert.equal(legacyIndexedMapProvenance(files, stats, "main"), undefined);
assert.equal(legacyIndexedMapProvenance(files, undefined, "preview"), undefined);
assert.equal(legacyIndexedMapProvenance(files, { ...stats, headCommit: undefined }, "preview"), undefined);
assert.equal(legacyIndexedMapProvenance(files, { ...stats, branch: undefined }, "preview"), undefined);
assert.equal(legacyIndexedMapProvenance(files, { ...stats, fileCount: 3 }, "preview"), undefined);
assert.equal(legacyIndexedMapProvenance([files[0], files[0]], stats, "preview"), undefined);
assert.equal(legacyIndexedMapProvenance([files[0], { ...files[1], sha: "b".repeat(40) }], stats, "preview"), undefined);
assert.equal(legacyIndexedMapProvenance(files, { ...stats, headCommit: "local" }, "preview"), undefined);
assert.equal(legacyIndexedMapProvenance([], { ...stats, fileCount: 0 }, "preview"), undefined);
console.log("legacy map provenance: exact branch, complete count, unique paths and every commit verified");

async function routeChecks(): Promise<void> {
  const orgId = "org-a", repoId = "github:org/repo";
  const cache = new GraphCache();
  const graph = blankRepositoryGraph({ repoId, owner: "org", repo: "repo" });
  graph.fileTree = files.map((file) => ({ ...file, size: 1, lastModified: new Date(), lastAuthor: "cloud-index" }));
  cache.setGraph(orgId, graph);
  let storedCommit = commit;
  const pool = { query: async (sql: string, params: unknown[]) => {
    assert.deepEqual(params, [orgId, sql.includes("FROM repo_stats") ? repoId : [repoId]]);
    if (sql.includes("FROM repo_stats")) return { rows: [{ branch: "preview", head_commit: storedCommit,
      file_count: 2, line_count: 20, byte_count: 50, languages: [], indexed_at: new Date() }] };
    return { rows: [{ repo_id: repoId }] };
  } };
  const request = (branch: string) => handleGraphHttp({ pathname: `/graph/${encodeURIComponent(repoId)}/tree`,
    searchParams: new URLSearchParams({ branch }), orgId, pool: pool as never, cache,
    graphQuery: new GraphQueryApi({ cache }) });
  const qualified = await request("preview");
  assert.equal(qualified.statusCode, 200);
  assert.equal((qualified.body as { indexedBranch: string }).indexedBranch, "preview");
  assert.equal((qualified.body as { indexedCommit: string }).indexedCommit, commit);
  assert.equal((await request("main")).statusCode, 404);
  storedCommit = "b".repeat(40);
  assert.equal((await request("preview")).statusCode, 404, "other index generations cannot certify this map");
  assert.equal((await request("")).statusCode, 200, "legacy unqualified tree consumers remain supported");
  console.log("legacy map HTTP route: org-scoped inventory, matching generation and branch required");
}
void routeChecks().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
