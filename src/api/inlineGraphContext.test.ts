import assert from "node:assert/strict";
import { GraphQueryApi } from "./graphQuery";
import { GraphCache } from "../cache/graphCache";
import type { DependencyEdge } from "../cache/graphCache";
import {
  fetchInlineGraphSlice,
  formatInlineGraphBlock,
  INLINE_GRAPH_TIMEOUT_MS
} from "./inlineGraphContext";

function seedGraph(cache: GraphCache, repoId: string, file: string): void {
  cache.upsertRepository(
    { repoId, owner: "acme", repo: "app" },
    {
      fileTree: [{ path: file, size: 100, lastModified: new Date(), lastAuthor: "dev", sha: "abc" }],
      dependencies: [{ from: "src/user.ts", to: file, type: "import" }],
      owners: [{ file, primaryOwner: "@alice", secondaryOwners: [], ownershipScore: 0.9 }]
    }
  );
}

void (async () => {
  let passed = 0;

  const block = formatInlineGraphBlock({
    file: "src/api/handler.ts",
    dependents: [{ from: "src/routes.ts", to: "src/api/handler.ts", type: "import" }],
    ownership: { file: "src/api/handler.ts", primaryOwner: "@alice", secondaryOwners: [], ownershipScore: 0.9 }
  });
  assert.match(block, /^GRAPH:/);
  assert.match(block, /owner: @alice/);
  passed++;

  const cache = new GraphCache();
  seedGraph(cache, "github:acme/app", "src/foo.ts");
  const graphQuery = new GraphQueryApi({ cache });

  const freeResult = await fetchInlineGraphSlice(
    { graphQuery },
    { repoId: "github:acme/app", file: "src/foo.ts", plan: "free" }
  );
  assert.equal(freeResult.status, "skipped");
  passed++;

  const proResult = await fetchInlineGraphSlice(
    { graphQuery },
    { repoId: "github:acme/app", file: "src/foo.ts", plan: "pro" }
  );
  assert.equal(proResult.status, "ok");
  if (proResult.status === "ok") {
    assert.match(proResult.block, /src\/user\.ts/);
  }
  passed++;

  const missingResult = await fetchInlineGraphSlice(
    { graphQuery: new GraphQueryApi({ cache: new GraphCache() }) },
    { repoId: "github:acme/missing", file: "src/foo.ts", plan: "pro" }
  );
  assert.equal(missingResult.status, "degraded");
  passed++;

  const slowQuery = {
    queryGraph: async () => {
      await new Promise((resolve) => setTimeout(resolve, INLINE_GRAPH_TIMEOUT_MS + 50));
      return { data: [] as DependencyEdge[] };
    }
  } as GraphQueryApi;
  const timeoutResult = await fetchInlineGraphSlice(
    { graphQuery: slowQuery },
    { repoId: "github:acme/app", file: "src/foo.ts", plan: "pro" }
  );
  assert.equal(timeoutResult.status, "degraded");
  passed++;

  console.log(`inlineGraphContext: ${passed}/${passed} tests passed`);
})();
