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
        resolveAbsolutePath: (relativePath) => path.join(root, relativePath),
        readRemoteFile: async ({ path: rel }) => {
          const abs = path.join(root, rel);
          if (!fs.existsSync(abs)) {
            return undefined;
          }
          return { path: rel, content: fs.readFileSync(abs, "utf8") };
        }
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

    assert.ok(result.steps.length >= 1 && result.steps.length <= 2);
    assert.equal(
      result.steps.every((step) => step.tool === "search_code"),
      true
    );
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

  await test("LLM planTurn chooses search then read (A-G1)", async () => {
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => ({
        path: rel,
        content: "export function verifyToken() {}"
      })
    });
    let round = 0;
    const result = await orchestrator.run(
      { message: "Where is verifyToken enforced in the codebase?", repoId: "acme/demo" },
      {
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "verifyToken" } });
          }
          if (round === 2) {
            return JSON.stringify({ tool: "read_file", args: { path: "src/auth.ts" } });
          }
          return JSON.stringify({ done: true });
        }
      }
    );
    assert.ok(result.steps.length >= 2);
    assert.equal(result.steps[0]?.tool, "search_code");
    assert.equal(result.steps[1]?.tool, "read_file");
    assert.equal(round >= 2, true);
  });

  await test("sanitizes full-question search queries to a short identifier", async () => {
    let seenQuery: string | undefined;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repoId, pattern) => {
          seenQuery = pattern;
          return {
            source: "zoekt",
            stale: false,
            hits: [
              {
                fileName: "apps/space/components/views/index.ts",
                lineNumber: 1,
                content: "export { AuthForm } from './auth'",
                score: 0.99
              },
              {
                fileName: "apps/api/plane/authentication/middleware.py",
                lineNumber: 12,
                content: "def require_auth():",
                score: 0.4
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => ({ path: rel, content: "def require_auth():\n  pass\n" })
    });
    const question = "Where is requireAuth or authentication middleware defined in this repo?";
    const result = await orchestrator.run({ message: question, repoId: "acme/demo" });
    assert.equal(seenQuery, "requireAuth");
    assert.equal(result.steps[0]?.summary.includes(question), false);
    assert.equal(result.steps[1]?.summary.includes("authentication/middleware.py"), true);
  });

  await test("reads the declaration line, not the top of the file", async () => {
    // The 2026-08-13 miss: the text hit carried no real position, so the loop
    // read lines 1-26 of a file whose definition was hundreds of lines down.
    // The symbol index knew the answer all along.
    const body = Array.from({ length: 500 }, (_, i) =>
      i === 411 ? "def require_auth(request):" : `# line ${i + 1}`
    ).join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "scip",
          stale: false,
          hits: [
            {
              fileName: "server/auth/middleware.py",
              lineNumber: 1,
              content: "server/auth/middleware.py",
              score: 1
            }
          ],
          symbols: [
            {
              symbol: "require_auth",
              kind: "function",
              file: "server/auth/middleware.py",
              line: 412,
              character: 0,
              displayName: "requireAuth"
            }
          ]
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => ({ path: rel, content: body })
    });

    const result = await orchestrator.run({
      message: "Where is requireAuth or authentication middleware defined in this repo?",
      repoId: "acme/demo"
    });
    const readFile = result.context?.read_file as { files?: Array<{ content: string }> };
    const content = readFile.files?.[0]?.content ?? "";
    assert.equal(content.includes("def require_auth(request):"), true);
    assert.equal(content.startsWith("# line 1\n"), false);
  });

  await test("reads a bounded window when the index gave no position", async () => {
    const body = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            { fileName: "server/auth/adapter.py", lineNumber: 0, content: "auth adapter", score: 1 }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => ({ path: rel, content: body })
    });

    const result = await orchestrator.run({ message: "where is the auth adapter?", repoId: "acme/demo" });
    const readFile = result.context?.read_file as { files?: Array<{ content: string }> };
    const lines = (readFile.files?.[0]?.content ?? "").split("\n");
    assert.equal(lines[0], "line 1");
    assert.ok(lines.length > 26 && lines.length <= 120);
  });

  await test("retries with a broader term when the first search returns only barrels", async () => {
    const seen: string[] = [];
    const readPaths: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repoId, pattern) => {
          seen.push(pattern);
          if (pattern === "requireAuth") {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: "packages/ui/src/index.ts",
                  lineNumber: 1,
                  content: "export * from './auth'",
                  score: 1
                },
                {
                  fileName: "node_modules/express/lib/router.js",
                  lineNumber: 1,
                  content: "exports.requireAuth = null",
                  score: 1
                }
              ],
              symbols: []
            };
          }
          return {
            source: "zoekt",
            stale: false,
            hits: [
              {
                fileName: "server/auth/middleware.py",
                lineNumber: 12,
                content: "class AuthenticationMiddleware:",
                score: 1
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        readPaths.push(rel);
        return { path: rel, content: "class AuthenticationMiddleware:\n  pass\n" };
      }
    });
    const question = "Where is requireAuth or authentication middleware defined in this repo?";
    const result = await orchestrator.run({ message: question, repoId: "acme/demo" });
    assert.equal(seen[0], "requireAuth");
    assert.ok(seen.length >= 2);
    assert.equal(
      readPaths.some((path) => path.includes("node_modules") || path.endsWith("index.ts")),
      false
    );
    assert.equal(
      result.steps.some((step) => step.summary.includes("server/auth/middleware.py")),
      true
    );
  });

  await test("LLM full-sentence query is rewritten before search", async () => {
    const seen: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repoId, pattern) => {
          seen.push(pattern);
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined
    });
    const question = "Where is requireAuth or authentication middleware defined in this repo?";
    await orchestrator.run(
      { message: question, repoId: "acme/demo" },
      {
        planTurn: async () =>
          JSON.stringify({ tool: "search_code", args: { query: question } })
      }
    );
    assert.equal(seen[0], "requireAuth");
    assert.equal(seen.includes(question), false);
  });

  await test("invalid first plan fails open to deterministic fallback (A-G3)", async () => {
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => ({ path: rel, content: "ok" })
    });
    const result = await orchestrator.run(
      { message: "where is verifyToken?", repoId: "acme/demo" },
      { planTurn: async () => "not-json {{{" }
    );
    assert.ok(result.steps.length >= 1);
    assert.equal(result.steps[0]?.tool, "search_code");
  });

  await test("aborted signal returns no hang (A-P3)", async () => {
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined
    });
    const signal = AbortSignal.abort();
    const result = await orchestrator.run(
      { message: "Where is auth middleware enforced across the codebase?", repoId: "acme/demo" },
      { signal, planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "auth" } }) }
    );
    assert.equal(result.steps.length, 0);
  });

  await test("forced repoId ignores model-supplied repo (A-P14 / UX-G10)", async () => {
    let seenRepo: string | undefined;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (repoId) => {
          seenRepo = repoId;
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined
    });
    await orchestrator.run(
      { message: "Where is auth middleware enforced across the codebase?", repoId: "acme/demo" },
      {
        planTurn: async () =>
          JSON.stringify({
            tool: "search_code",
            args: { query: "auth", repoId: "evil/other" }
          })
      }
    );
    assert.equal(seenRepo, "acme/demo");
  });

  await test("caps at 8 model-chosen rounds (A-P2)", async () => {
    let calls = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined
    });
    const result = await orchestrator.run(
      { message: "Where is auth middleware enforced across the codebase?", repoId: "acme/demo" },
      {
        planTurn: async () => {
          calls += 1;
          return JSON.stringify({ tool: "search_code", args: { query: `q${calls}` } });
        }
      }
    );
    assert.equal(result.steps.length, 8);
    assert.equal(calls, 8);
  });

  console.log(`\nAgentOrchestrator: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
