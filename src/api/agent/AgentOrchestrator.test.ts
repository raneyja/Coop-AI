import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { IndexBackend } from "../../indexing/indexBackend";
import type { LocalSearchResult } from "../../indexing/types";
import { createAgentOrchestrator, pickTopSearchHit } from "./AgentOrchestrator";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
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

function mockIndexBackend(overrides: Partial<IndexBackend> = {}): IndexBackend {
  return {
    kind: "local",
    isEnabledForRepo: async () => true,
    enableRepo: async () => ({
      repoId: "acme/demo",
      enabled: true,
      status: "ready"
    }),
    disableRepo: async () => undefined,
    refreshRepo: async () => ({
      repoId: "acme/demo",
      enabled: true,
      status: "ready"
    }),
    getRepoStatus: async () => undefined,
    listRepoStatuses: async () => [],
    search: async () =>
      ({
        source: "zoekt",
        stale: false,
        hits: [
          {
            fileName: "src/auth.ts",
            lineNumber: 12,
            content: "export function verifyToken() {}",
            score: 0.9
          },
          {
            fileName: "src/util.ts",
            lineNumber: 3,
            content: "export function helper() {}",
            score: 0.4
          }
        ],
        symbols: []
      }) satisfies LocalSearchResult,
    dependents: async () => ({ file: "src/auth.ts", dependents: [], source: "scip" }),
    summarize: async () => ({
      enabledRepos: 1,
      totalDiskBytes: 0,
      readyRepos: 1,
      indexingRepos: 0
    }),
    ...overrides
  };
}

async function run(): Promise<void> {
  await test("pickTopSearchHit prefers highest score", () => {
    const top = pickTopSearchHit([
      { fileName: "a.ts", lineNumber: 1, score: 0.2 },
      { fileName: "b.ts", lineNumber: 2, score: 0.95 }
    ]);
    assert.equal(top?.fileName, "b.ts");
  });

  await test("run executes search_code then read_file on top hit", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-agent-run-"));
    const filePath = path.join(root, "src", "auth.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "export function verifyToken() {}\n", "utf8");

    try {
      const orchestrator = createAgentOrchestrator({
        indexBackend: mockIndexBackend(),
        resolveAbsolutePath: (relativePath) => path.join(root, relativePath)
      });

      const result = await orchestrator.run({
        message: "where is verifyToken?",
        repoId: "acme/demo"
      });

      assert.equal(result.steps.length, 2);
      assert.equal(result.steps[0]?.tool, "search_code");
      assert.equal(result.steps[1]?.tool, "read_file");
      assert.ok(result.context?.search_code);
      const readFile = result.context?.read_file as { files?: Array<{ path: string; content: string }> };
      assert.equal(readFile.files?.[0]?.path, "src/auth.ts");
      assert.ok(readFile.files?.[0]?.content.includes("verifyToken"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("run stops after search when index returns no hits", async () => {
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined
    });

    const result = await orchestrator.run({
      message: "missing symbol",
      repoId: "acme/demo"
    });

    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0]?.tool, "search_code");
    assert.equal(result.context?.read_file, undefined);
  });

  await test("run returns empty when repoId is missing", async () => {
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined
    });

    const result = await orchestrator.run({ message: "auth flow" });
    assert.equal(result.steps.length, 0);
    assert.equal(result.context, undefined);
  });

  await test("run respects maxSteps=1 (search only)", async () => {
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined
    });

    const result = await orchestrator.run({
      message: "verifyToken",
      repoId: "acme/demo",
      maxSteps: 1
    });

    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0]?.tool, "search_code");
    assert.equal(result.context?.read_file, undefined);
  });

  console.log(`\nAgentOrchestrator: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
