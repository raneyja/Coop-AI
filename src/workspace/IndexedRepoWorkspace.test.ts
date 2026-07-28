import assert from "node:assert/strict";
import { IndexedRepoWorkspace, mergeRepoInventoryContext } from "./IndexedRepoWorkspace";
import { repoFactNeeds } from "./repoFactIntent";
import type { RepoInventoryEvidence } from "./indexedRepoWorkspaceTypes";
import type { ContextFetchResult } from "../context/requestBatcher";
import type { RepoInventoryDeps } from "./repoInventorySources";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

type StubOptions = {
  indexStats?: {
    fileCount: number;
    lineCount?: number;
    byteCount?: number;
    languages?: string[];
    indexedAt?: string;
  };
  manifest?: { fileCount?: number; lastCrawledAt?: string };
  treeCount?: { fileCount: number; truncated?: boolean };
};

function stubDeps(options: StubOptions): { deps: RepoInventoryDeps; calls: string[] } {
  const calls: string[] = [];
  const deps = {
    apiBaseUrl: "https://api.coop-ai.dev",
    api: {
      fetchRepoInventoryViaCloud: async () => {
        calls.push("index-stats");
        return options.indexStats;
      },
      fetchRepoManifest: async () => {
        calls.push("manifest");
        if (!options.manifest) {
          throw new Error("no manifest");
        }
        return options.manifest;
      }
    },
    codeHostRouter: {
      countRepositoryFiles: async () => {
        calls.push("tree");
        if (!options.treeCount) {
          throw new Error("no tree");
        }
        return options.treeCount;
      }
    }
  } as unknown as RepoInventoryDeps;
  return { deps, calls };
}

const LOC_TARGET = { repoId: "github:raneyja/Coop-AI", branch: "main" };

void (async () => {
  await test("index stats win and carry a real line count", async () => {
    const { deps, calls } = stubDeps({
      indexStats: { fileCount: 1233, lineCount: 66934, languages: ["ts", "md"] },
      treeCount: { fileCount: 9999 }
    });
    const workspace = new IndexedRepoWorkspace(deps);
    const inventory = await workspace.getInventory(
      LOC_TARGET,
      repoFactNeeds("how many lines of code are in this repo?")
    );

    assert.equal(inventory.source, "index-stats");
    assert.equal(inventory.fileCount, 1233);
    assert.equal(inventory.lineCount, 66934);
    // Ordered, not raced: the slow live tree is never consulted once stats exist.
    assert.deepEqual(calls, ["index-stats"]);
  });

  await test("two phrasings of the same LOC question return the identical number", async () => {
    const { deps } = stubDeps({ indexStats: { fileCount: 1233, lineCount: 66934 } });
    const workspace = new IndexedRepoWorkspace(deps);

    const first = await workspace.getInventory(
      LOC_TARGET,
      repoFactNeeds("how many lines of code are in this repo in total?")
    );
    const second = await workspace.getInventory(LOC_TARGET, repoFactNeeds("HOW MANY LINES OF CODE"));

    assert.equal(first.lineCount, second.lineCount);
    assert.equal(first.fileCount, second.fileCount);
    assert.equal(first.source, second.source);
  });

  await test("falls back through manifest to tree in a fixed order", async () => {
    const { deps, calls } = stubDeps({ treeCount: { fileCount: 1233, truncated: true } });
    const workspace = new IndexedRepoWorkspace(deps);
    const inventory = await workspace.getInventory(LOC_TARGET, repoFactNeeds("how many files in this repo?"));

    assert.equal(inventory.source, "tree");
    assert.equal(inventory.fileCount, 1233);
    assert.equal(inventory.truncated, true);
    assert.deepEqual(calls, ["index-stats", "manifest", "tree"]);
  });

  await test("chat hot path skips expensive live tree walk", async () => {
    const { deps, calls } = stubDeps({ treeCount: { fileCount: 1233 } });
    const workspace = new IndexedRepoWorkspace(deps);
    const inventory = await workspace.getInventory(
      LOC_TARGET,
      repoFactNeeds("how many files in this repo?"),
      { allowExpensiveTreeWalk: false }
    );

    assert.equal(inventory.source, "unavailable");
    assert.deepEqual(calls, ["index-stats", "manifest"]);
  });

  await test("file-count-only sources refuse to supply a line count", async () => {
    const { deps } = stubDeps({ treeCount: { fileCount: 1233 } });
    const workspace = new IndexedRepoWorkspace(deps);
    const inventory = await workspace.getInventory(
      LOC_TARGET,
      repoFactNeeds("how many lines of code are in this repo?")
    );

    assert.equal(inventory.fileCount, 1233);
    assert.equal(inventory.lineCount, undefined);
    assert.match(inventory.note ?? "", /line count is unavailable|No line count is recorded/i);
    assert.match(inventory.note ?? "", /do not estimate/i);
  });

  await test("no sources yields unavailable with a refusal instruction", async () => {
    const { deps } = stubDeps({});
    const workspace = new IndexedRepoWorkspace(deps);
    const inventory = await workspace.getInventory(
      LOC_TARGET,
      repoFactNeeds("how many lines of code are in this repo?")
    );

    assert.equal(inventory.source, "unavailable");
    assert.equal(inventory.fileCount, undefined);
    assert.match(inventory.note ?? "", /do not estimate/i);
  });

  await test("no selected repo never guesses", async () => {
    const { deps, calls } = stubDeps({ indexStats: { fileCount: 10, lineCount: 20 } });
    const workspace = new IndexedRepoWorkspace(deps);
    const inventory = await workspace.getInventory({}, repoFactNeeds("how many files?"));

    assert.equal(inventory.source, "unavailable");
    assert.deepEqual(calls, []);
  });

  await test("getIdentity normalizes bare owner/repo ids", () => {
    const { deps } = stubDeps({});
    const identity = new IndexedRepoWorkspace(deps).getIdentity({
      repoId: "raneyja/Coop-AI",
      provider: "github",
      branch: "main"
    });
    assert.equal(identity?.repoId, "github:raneyja/Coop-AI");
    assert.equal(identity?.owner, "raneyja");
    assert.equal(identity?.repo, "Coop-AI");
    assert.equal(identity?.branch, "main");
  });

  await test("mergeRepoInventoryContext attaches inventory and tree overview", () => {
    const base: ContextFetchResult = {
      requestId: "req",
      type: "chat_context",
      data: { context: { repo: "Coop-AI" } },
      fetchedAt: new Date()
    };
    const inventory: RepoInventoryEvidence = {
      source: "index-stats",
      fileCount: 1233,
      lineCount: 66934
    };
    const merged = mergeRepoInventoryContext(base, inventory, {
      topLevelDirs: ["src", "docs"],
      topLevelFiles: ["package.json"]
    });
    const data = merged.data as {
      repoInventory?: RepoInventoryEvidence;
      treeOverview?: { topLevelDirs: string[] };
      context?: { repo?: string };
    };
    assert.equal(data.repoInventory?.lineCount, 66934);
    assert.deepEqual(data.treeOverview?.topLevelDirs, ["src", "docs"]);
    assert.equal(data.context?.repo, "Coop-AI");
  });

  await test("readFile falls back to codeHostRouter when cloud fetch fails", async () => {
    const deps = {
      apiBaseUrl: "https://api.coop-ai.dev",
      api: {
        getBackendClient: () => ({
          fetchRepoFile: async () => {
            throw new Error("cloud unavailable");
          }
        })
      },
      codeHostRouter: {
        getFileContent: async (path: string) => ({
          path,
          content: "# from browse path\n",
          encoding: "utf-8" as const,
          lines: [{ number: 1, text: "# from browse path" }]
        })
      }
    } as unknown as RepoInventoryDeps;
    const workspace = new IndexedRepoWorkspace(deps);
    const file = await workspace.readFile(
      {
        repoId: "github:CoopAI-Corp/plane",
        owner: "CoopAI-Corp",
        repo: "plane",
        branch: "preview",
        provider: "github"
      },
      "README.md"
    );
    assert.equal(file?.content?.includes("from browse path"), true);
    assert.equal(file?.origin, "remote");
  });

  console.log(`\nIndexedRepoWorkspace: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
})();
