import assert from "node:assert/strict";
import { GraphQueryApi } from "./graphQuery";
import { GraphCache } from "../cache/graphCache";
import type { DependencyEdge } from "../cache/graphCache";
import {
  fetchInlineGraphSlice,
  formatInlineGraphBlock,
  formatSnippetLines,
  INLINE_GRAPH_TIMEOUT_MS,
  pickSnippetPaths
} from "./inlineGraphContext";

function seedGraph(cache: GraphCache, repoId: string, file: string): void {
  cache.upsertRepository(
    { repoId, provider: "github", owner: "acme", repo: "app" },
    {
      fileTree: [{ path: file, size: 100, lastModified: new Date(), lastAuthor: "dev", sha: "abc" }],
      dependencies: [
        { from: "src/user.ts", to: file, type: "import" },
        { from: file, to: "src/util.ts", type: "import" }
      ],
      owners: [{ file, primaryOwner: "@alice", secondaryOwners: [], ownershipScore: 0.9 }]
    }
  );
}

void (async () => {
  let passed = 0;

  assert.equal(INLINE_GRAPH_TIMEOUT_MS, 250);

  assert.deepEqual(
    pickSnippetPaths({
      dependents: [{ from: "src/user.ts", to: "src/foo.ts", type: "import" }],
      imports: [{ from: "src/foo.ts", to: "src/util.ts", type: "import" }]
    }),
    ["src/user.ts", "src/util.ts"]
  );
  passed++;

  assert.equal(
    formatSnippetLines("import foo from 'bar';\n\nexport function run() {\n  return 1;\n}"),
    "import foo from 'bar'; | export function run() {"
  );
  passed++;

  const block = formatInlineGraphBlock({
    file: "src/api/handler.ts",
    dependents: [{ from: "src/routes.ts", to: "src/api/handler.ts", type: "import" }],
    imports: [{ from: "src/api/handler.ts", to: "src/util.ts", type: "import" }],
    ownership: { file: "src/api/handler.ts", primaryOwner: "@alice", secondaryOwners: [], ownershipScore: 0.9 },
    snippets: {
      "src/routes.ts": "import handler from './api/handler';",
      "src/util.ts": "export const util = () => true;"
    }
  });
  assert.match(block, /^GRAPH:/);
  assert.match(block, /owner: @alice/);
  assert.match(block, /imports:/);
  assert.match(block, /src\/util\.ts/);
  assert.match(block, /snippet: export const util/);
  assert.match(block, /snippet: import handler/);
  passed++;

  const cache = new GraphCache();
  seedGraph(cache, "github:acme/app", "src/foo.ts");
  const graphQuery = new GraphQueryApi({ cache });

  const freeResult = await fetchInlineGraphSlice(
    { graphQuery },
    { repoId: "github:acme/app", file: "src/foo.ts", plan: "free" }
  );
  assert.equal(freeResult.status, "ok");
  if (freeResult.status === "ok") {
    assert.match(freeResult.block, /src\/user\.ts/);
    assert.match(freeResult.block, /src\/util\.ts/);
  }
  passed++;

  const snippetResult = await fetchInlineGraphSlice(
    {
      graphQuery,
      fetchFileSnippet: async ({ path }) => {
        if (path === "src/user.ts") {
          return "export class User {}\n";
        }
        if (path === "src/util.ts") {
          return "export function helper() {}\n";
        }
        return undefined;
      }
    },
    { repoId: "github:acme/app", file: "src/foo.ts", plan: "pro", orgId: "org-1" }
  );
  assert.equal(snippetResult.status, "ok");
  if (snippetResult.status === "ok") {
    assert.match(snippetResult.block, /snippet: export class User/);
    assert.match(snippetResult.block, /snippet: export function helper/);
  }
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
  } as unknown as GraphQueryApi;
  const timeoutResult = await fetchInlineGraphSlice(
    { graphQuery: slowQuery },
    { repoId: "github:acme/app", file: "src/foo.ts", plan: "pro" }
  );
  assert.equal(timeoutResult.status, "degraded");
  passed++;

  console.log(`inlineGraphContext: ${passed}/${passed} tests passed`);
})();
