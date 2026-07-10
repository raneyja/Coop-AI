import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { IndexBackend } from "../../../indexing/indexBackend";
import type { LocalSearchResult } from "../../../indexing/types";
import { createAgentOrchestrator } from "../AgentOrchestrator";
import { createAgentToolRegistry } from "./registry";

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
  await test("search_code returns indexed hits with repoId:path:line citations", async () => {
    const registry = createAgentToolRegistry({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined
    });
    const raw = await registry.search_code!({ query: "verifyToken", repoId: "acme/demo" });
    const parsed = JSON.parse(raw) as {
      hits: Array<{ citation: string; fileName: string }>;
      repoId: string;
    };
    assert.equal(parsed.repoId, "acme/demo");
    assert.equal(parsed.hits[0]?.citation, "acme/demo:src/auth.ts:12");
    assert.equal(parsed.hits[0]?.fileName, "src/auth.ts");
  });

  await test("search_code reports when index is disabled for repo", async () => {
    const registry = createAgentToolRegistry({
      indexBackend: mockIndexBackend({
        isEnabledForRepo: async () => false
      }),
      resolveAbsolutePath: () => undefined
    });
    const raw = await registry.search_code!({ query: "auth", repoId: "acme/demo" });
    const parsed = JSON.parse(raw) as { error: string };
    assert.match(parsed.error, /not enabled/i);
  });

  await test("read_file reads workspace file content", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-agent-read-"));
    const filePath = path.join(root, "src", "panel.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "export function bindSession() {}", "utf8");

    try {
      const registry = createAgentToolRegistry({
        indexBackend: mockIndexBackend(),
        resolveAbsolutePath: (relativePath) => path.join(root, relativePath)
      });
      const raw = await registry.read_file!({ path: "src/panel.ts" });
      const parsed = JSON.parse(raw) as { files: Array<{ content: string }> };
      assert.ok(parsed.files[0]?.content.includes("bindSession"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("read_file slices line range when requested", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "coop-agent-lines-"));
    const filePath = path.join(root, "src", "lines.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, ["line1", "line2", "line3", "line4", "line5"].join("\n"), "utf8");

    try {
      const registry = createAgentToolRegistry({
        indexBackend: mockIndexBackend(),
        resolveAbsolutePath: (relativePath) => path.join(root, relativePath)
      });
      const raw = await registry.read_file!({ path: "src/lines.ts", startLine: 3, endLine: 3 });
      const parsed = JSON.parse(raw) as { files: Array<{ content: string; lineRange?: [number, number] }> };
      assert.ok(parsed.files[0]?.content.includes("line3"));
      assert.ok(parsed.files[0]?.lineRange);
      assert.equal(parsed.files[0]?.lineRange?.[0], 1);
      assert.equal(parsed.files[0]?.lineRange?.[1], 5);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("AgentOrchestrator.executeTool dispatches to registry", async () => {
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined
    });
    const raw = await orchestrator.executeTool("search_code", {
      query: "verifyToken",
      repoId: "acme/demo"
    });
    const parsed = JSON.parse(raw) as { hits: unknown[] };
    assert.equal(parsed.hits.length, 1);
  });

  console.log(`\nagent tool registry: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
