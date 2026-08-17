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

  await test("search_code follows camelCase aliases to snake_case hits", async () => {
    const seen: string[] = [];
    const registry = createAgentToolRegistry({
      indexBackend: mockIndexBackend({
        search: async (_repoId, pattern) => {
          seen.push(pattern);
          if (pattern === "require_auth") {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: "server/auth/middleware.py",
                  lineNumber: 40,
                  content: "def require_auth(request):",
                  score: 0.9
                }
              ],
              symbols: [
                {
                  file: "server/auth/middleware.py",
                  line: 40,
                  character: 0,
                  symbol: "require_auth",
                  kind: "function",
                  displayName: "require_auth"
                }
              ]
            };
          }
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined
    });
    const raw = await registry.search_code!({ query: "requireAuth", repoId: "acme/demo" });
    const parsed = JSON.parse(raw) as {
      hits: Array<{ fileName: string; content: string }>;
      queriesTried: string[];
    };
    assert.ok(seen.includes("requireAuth"));
    assert.ok(seen.includes("require_auth"));
    assert.ok(parsed.queriesTried.includes("require_auth"));
    assert.equal(parsed.hits[0]?.fileName, "server/auth/middleware.py");
    assert.match(parsed.hits[0]?.content ?? "", /require_auth/);
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

  await test("read_file does not use local workspace absolute paths (Zero-Clone)", async () => {
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
      const parsed = JSON.parse(raw) as { error?: string; files?: unknown[] };
      assert.match(parsed.error ?? "", /Could not read file/i);
      assert.equal(parsed.files, undefined);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test("read_file requires a remote reader for line windows", async () => {
    const registry = createAgentToolRegistry({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => "/tmp/never-used.ts"
    });
    const raw = await registry.read_file!({ path: "src/lines.ts", startLine: 3, endLine: 3 });
    const parsed = JSON.parse(raw) as { error?: string };
    assert.match(parsed.error ?? "", /Could not read file/i);
  });

  await test("read_file falls back to the remote workspace when there is no local clone", async () => {
    const requested: Array<{ path: string; repoId?: string }> = [];
    const registry = createAgentToolRegistry({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: filePath, repoId }) => {
        requested.push({ path: filePath, repoId });
        return { path: filePath, content: "line1\nline2\nline3\nline4" };
      }
    });

    const raw = await registry.read_file!({ path: "src/remote.ts", repoId: "github:acme/demo" });
    const parsed = JSON.parse(raw) as { files: Array<{ content: string }> };
    assert.ok(parsed.files[0]?.content.includes("line1"));
    assert.deepEqual(requested, [{ path: "src/remote.ts", repoId: "github:acme/demo" }]);
  });

  await test("remote read_file honors the requested line window", async () => {
    const registry = createAgentToolRegistry({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: filePath }) => ({
        path: filePath,
        content: ["line1", "line2", "line3", "line4", "line5"].join("\n")
      })
    });

    const raw = await registry.read_file!({ path: "src/remote.ts", startLine: 2, endLine: 3 });
    const parsed = JSON.parse(raw) as { files: Array<{ content: string }> };
    assert.equal(parsed.files[0]?.content, "line2\nline3");
  });

  await test("read_file errors plainly when neither local nor remote can serve the file", async () => {
    const registry = createAgentToolRegistry({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined
    });
    const raw = await registry.read_file!({ path: "src/missing.ts" });
    const parsed = JSON.parse(raw) as { error: string };
    assert.match(parsed.error, /Could not read file/i);
  });

  await test("AgentOrchestrator passes repoId so remote reads can resolve", async () => {
    const requested: Array<{ path: string; repoId?: string }> = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: filePath, repoId }) => {
        requested.push({ path: filePath, repoId });
        return { path: filePath, content: "export function verifyToken() {}" };
      }
    });

    await orchestrator.run({ message: "how does verifyToken work?", repoId: "github:acme/demo" });
    assert.deepEqual(requested, [{ path: "src/auth.ts", repoId: "github:acme/demo" }]);
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
