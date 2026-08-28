import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { IndexBackend } from "../../indexing/indexBackend";
import type { LocalSearchResult } from "../../indexing/types";
import { createAgentOrchestrator, pickTopSearchHit } from "./AgentOrchestrator";
import { COPILOT_C1_ASK, COPILOT_C2_ASK } from "./dogfoodContract";

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

    assert.ok(result.steps.length >= 1 && result.steps.length <= 3);
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

  await test("locate with planTurn uses the LLM loop (same conversation)", async () => {
    let planCalls = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend(),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => ({
        path: rel,
        content: "export function verifyToken() {}"
      })
    });
    const result = await orchestrator.run(
      {
        message: "Where is verifyToken defined?",
        repoId: "acme/demo",
        action: "locate"
      },
      {
        planTurn: async () => {
          planCalls += 1;
          if (planCalls === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "verifyToken" } });
          }
          if (planCalls === 2) {
            return JSON.stringify({ tool: "read_file", args: { path: "src/auth.ts" } });
          }
          return JSON.stringify({ done: true });
        }
      }
    );
    assert.ok(planCalls >= 2);
    assert.ok(result.steps.some((s) => s.tool === "search_code"));
    assert.ok(result.steps.some((s) => s.tool === "read_file"));
  });

  await test("sanitizes full-question search queries to a short identifier", async () => {
    const seen: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repoId, pattern) => {
          seen.push(pattern);
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
    assert.ok(seen.includes("requireAuth"), `expected requireAuth, got ${seen.join(",")}`);
    assert.equal(seen.includes(question), false);
    assert.equal(result.steps[0]?.summary.includes(question), false);
    assert.equal(result.steps[1]?.summary.includes("authentication/middleware.py"), true);
  });

  await test("change hunt skips auth UI that never mentions requireAuth", async () => {
    const reads: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: "apps/space/components/account/auth-forms/auth-root.tsx",
              lineNumber: 10,
              content: "export function AuthRoot() { return null }",
              score: 0.99
            },
            {
              fileName: "apps/api/plane/authentication/middleware.py",
              lineNumber: 40,
              content: "def require_auth(request):",
              score: 0.2
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel.includes("middleware")) {
          return { path: rel, content: "def require_auth(request):\n  return True\n" };
        }
        return { path: rel, content: "export function AuthRoot() { return null }\n" };
      }
    });
    const result = await orchestrator.run({
      message: "add logging around requireAuth",
      repoId: "acme/demo",
      action: "change"
    });
    assert.equal(reads.includes("apps/api/plane/authentication/middleware.py"), true);
    assert.equal(
      (result.context?.read_file as { files?: Array<{ path: string }> } | undefined)?.files?.[0]
        ?.path,
      "apps/api/plane/authentication/middleware.py"
    );
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
    assert.equal(lines[0], "1|line 1");
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
                content: "def require_auth():\nclass AuthenticationMiddleware:",
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
        return { path: rel, content: "def require_auth():\n  pass\nclass AuthenticationMiddleware:\n  pass\n" };
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

  await test("wrong first hit forces a second read before done (dogfood)", async () => {
    const uiPath = "web/components/auth/login-form.tsx";
    const apiPath = "server/auth/middleware.py";
    const reads: string[] = [];
    let round = 0;
    let answerAfterReads = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: uiPath,
              lineNumber: 10,
              content: "export function LoginForm() { return null }",
              score: 0.99
            },
            {
              fileName: apiPath,
              lineNumber: 40,
              content: "def require_auth(request):",
              score: 0.2
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel.includes("middleware")) {
          return { path: rel, content: "def require_auth(request):\n  return True\n" };
        }
        return { path: rel, content: "export function LoginForm() { return null }\n" };
      }
    });
    const result = await orchestrator.run(
      {
        message: "Where is requireAuth defined in this repo?",
        repoId: "acme/demo",
        action: "locate",
        maxSteps: 8
      },
      {
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "requireAuth" } });
          }
          if (round === 2) {
            return JSON.stringify({ tool: "read_file", args: { path: uiPath } });
          }
          if (round === 3) {
            return JSON.stringify({ done: true });
          }
          if (round === 4) {
            return JSON.stringify({ tool: "read_file", args: { path: apiPath } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => {
          answerAfterReads = reads.length;
          return "require_auth is defined in server/auth/middleware.py";
        }
      }
    );
    assert.ok(round >= 5, `done after the UI read must be rejected; rounds=${round}`);
    assert.equal(reads.includes(uiPath), true);
    assert.equal(reads.includes(apiPath), true);
    assert.ok(answerAfterReads >= 2, "answer must wait until a second read");
    assert.match(result.answer ?? "", /middleware\.py/);
    const readSteps = result.steps.filter((s) => s.tool === "read_file");
    assert.ok(readSteps.length >= 2, `expected ≥2 reads, got ${readSteps.length}`);
  });

  await test("empty hunt does not stream a Your question restatement", async () => {
    let streamed = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({ source: "zoekt", stale: false, hits: [], symbols: [] })
      }),
      resolveAbsolutePath: () => undefined
    });
    const result = await orchestrator.run(
      {
        message: "Where is requireAuth defined in this repo?",
        repoId: "acme/demo",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "requireAuth" } }),
        streamAnswer: async () => {
          streamed += 1;
          return "**Your question**\nWhere is requireAuth defined in this repo?";
        }
      }
    );
    assert.equal(streamed, 0, "must not call the answer model on an empty hunt");
    assert.match(result.answer ?? "", /will not guess a path/i);
    assert.doesNotMatch(result.answer ?? "", /Your question/);
  });

  await test("role-noun hunt rejects a collab auth read that never says middleware", async () => {
    const collabPath = "collab/session/auth.ts";
    const middlewarePath = "server/http/middleware.py";
    const reads: string[] = [];
    let round = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: collabPath,
              lineNumber: 8,
              content: "export async function onAuthenticate() { return true }",
              score: 0.99
            },
            {
              fileName: middlewarePath,
              lineNumber: 12,
              content: "def auth_middleware(get_response):",
              score: 0.2
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel.includes("middleware")) {
          return {
            path: rel,
            content: "def auth_middleware(get_response):\n  return get_response\n"
          };
        }
        return {
          path: rel,
          content: "export async function onAuthenticate(token) { return token; }\n"
        };
      }
    });
    const result = await orchestrator.run(
      {
        message: "Where is auth middleware enforced and what calls it?",
        repoId: "acme/demo",
        action: "locate",
        maxSteps: 8
      },
      {
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "auth" } });
          }
          if (round === 2) {
            return JSON.stringify({ tool: "read_file", args: { path: collabPath } });
          }
          if (round === 3) {
            return JSON.stringify({ done: true });
          }
          if (round === 4) {
            return JSON.stringify({ tool: "read_file", args: { path: middlewarePath } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "auth_middleware is defined in server/http/middleware.py"
      }
    );
    assert.ok(round >= 5, `done after the collab read must be rejected; rounds=${round}`);
    assert.equal(reads.includes(collabPath), true);
    assert.equal(reads.includes(middlewarePath), true);
    assert.match(result.answer ?? "", /middleware\.py/);
  });

  await test("feature-add with open file seeds read_file and does not post INDEX_HUNT_MISS", async () => {
    const mapper = "apps/api/plane/utils/issue_relation_mapper.py";
    const ask =
      "We're adding a blocked_by issue link type this sprint. Where should validation live, and which existing link types in this mapper should I mirror so we don't fork a second relation model?";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === mapper
          ? {
              path: rel,
              content: "RELATION_MAP = {\n  'blocking': 'blocked_by',\n  'related': 'related',\n}\n"
            }
          : undefined
    });
    let planCalls = 0;
    const result = await orchestrator.run(
      {
        message: ask,
        repoId: "github:coop-ai/plane",
        action: "locate",
        openFile: mapper
      },
      {
        planTurn: async () => {
          planCalls += 1;
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "Validation belongs in issue_relation_mapper.py next to blocking / related."
      }
    );
    assert.equal(result.steps[0]?.tool, "read_file");
    assert.equal(planCalls >= 1, true);
    assert.match(result.answer ?? "", /issue_relation_mapper/);
    assert.doesNotMatch(result.answer ?? "", /could not find an indexed file/i);
  });

  await test("named filename seeds read_file even when the body uses a different export", async () => {
    const filePath = "src/server/authMiddleware.ts";
    const body = "export function extractBearerToken(header) {\n  return header;\n}\n";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      findFiles: async ({ query }) =>
        query.toLowerCase().includes("authmiddleware") ? [filePath] : [],
      readRemoteFile: async ({ path: rel }) =>
        rel === filePath ? { path: rel, content: body } : undefined
    });
    const result = await orchestrator.run(
      {
        message: "Find authMiddleware.ts and show me the export.",
        repoId: "github:acme/demo",
        action: "locate"
      },
      {
        planTurn: async () => JSON.stringify({ done: true }),
        streamAnswer: async ({ conversation }) => {
          const blob = JSON.stringify(conversation);
          assert.match(blob, /extractBearerToken/);
          return "The export in src/server/authMiddleware.ts is extractBearerToken.";
        }
      }
    );
    assert.equal(result.steps[0]?.tool, "read_file");
    assert.match(result.steps[0]?.summary ?? "", /authMiddleware\.ts/);
    assert.doesNotMatch(result.answer ?? "", /could not find an indexed file/i);
    assert.match(result.answer ?? "", /extractBearerToken/);
  });

  await test("named path seeds the same read as a follow-up Read prompt", async () => {
    const filePath = "src/server/authMiddleware.ts";
    const body = "export function extractBearerToken(header) {\n  return header;\n}\n";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === filePath ? { path: rel, content: body } : undefined
    });
    const result = await orchestrator.run(
      {
        message: "Read src/server/authMiddleware.ts and show me the export.",
        repoId: "github:acme/demo",
        action: "locate"
      },
      {
        planTurn: async () => JSON.stringify({ done: true }),
        streamAnswer: async () => "The export is extractBearerToken."
      }
    );
    assert.equal(result.steps[0]?.tool, "read_file");
    assert.match(result.answer ?? "", /extractBearerToken/);
  });

  await test("planTurn startLine:1 still reads the class, not only the copyright line", async () => {
    const body = [
      "# Copyright (c) 2023-present Plane Software, Inc. and contributors",
      ...Array.from({ length: 15 }, (_, i) => `# filler ${i + 2}`),
      "class APIKeyAuthentication:",
      "    def authenticate(self, request):",
      "        return True"
    ].join("\n");
    const authPath = "apps/api/plane/api/middleware/api_authentication.py";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "scip",
          stale: false,
          hits: [
            {
              fileName: authPath,
              lineNumber: 1,
              content: "# Copyright (c) 2023-present Plane Software, Inc. and contributors",
              score: 1
            }
          ],
          symbols: [
            {
              symbol: "APIKeyAuthentication",
              kind: "class",
              file: authPath,
              line: 17,
              character: 0,
              displayName: "APIKeyAuthentication"
            }
          ]
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => ({ path: rel, content: body })
    });
    let round = 0;
    const result = await orchestrator.run(
      {
        message: "Where is APIKeyAuthentication defined, and what requests does it actually authenticate?",
        repoId: "coop-ai/plane"
      },
      {
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "APIKeyAuthentication" } });
          }
          if (round === 2) {
            return JSON.stringify({
              tool: "read_file",
              args: { path: authPath, startLine: 1, endLine: 1 }
            });
          }
          return JSON.stringify({ done: true });
        }
      }
    );
    const readFile = result.context?.read_file as { files?: Array<{ content: string }> };
    const content = readFile?.files?.[0]?.content ?? "";
    assert.match(content, /17\|class APIKeyAuthentication:/);
    assert.equal(content.trim() === "1|# Copyright (c) 2023-present Plane Software, Inc. and contributors", false);
  });

  await test("C1 Authorization-Bearer ask streams when the index has a Bearer hit", async () => {
    const filePath = "src/server/authMiddleware.ts";
    const body =
      'export function extractBearerToken(headers) {\n  const header = headers.authorization ?? "";\n  if (!header.startsWith("Bearer ")) {\n    return undefined;\n  }\n  return header.slice(7).trim() || undefined;\n}\n';
    let streamed = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: filePath,
              lineNumber: 10,
              content: 'if (!header.startsWith("Bearer ")) {',
              score: 0.9
            }
          ],
          symbols: [
            {
              symbol: "extractBearerToken",
              kind: "function",
              file: filePath,
              line: 10,
              character: 0,
              displayName: "extractBearerToken"
            }
          ]
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === filePath ? { path: rel, content: body } : undefined
    });
    let round = 0;
    const result = await orchestrator.run(
      {
        message: COPILOT_C1_ASK,
        repoId: "github:raneyja/Coop-AI",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "Authorization" } });
          }
          if (round === 2) {
            return JSON.stringify({ tool: "read_file", args: { path: filePath } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => {
          streamed += 1;
          return "extractBearerToken in src/server/authMiddleware.ts parses the Bearer token.";
        }
      }
    );
    assert.equal(streamed, 1);
    assert.doesNotMatch(result.answer ?? "", /could not find an indexed file/i);
    assert.match(result.answer ?? "", /extractBearerToken/);
  });

  await test("C2 work-item ask streams when the index has a transition hit", async () => {
    const filePath = "apps/api/issues/work_item_state.py";
    const body =
      'def write_work_item_state(item, new_state):\n    if not is_valid_transition(item.state, new_state):\n        raise ValueError("cannot move work item out of backlog")\n    item.state = new_state\n';
    let streamed = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: filePath,
              lineNumber: 12,
              content: "def write_work_item_state(item, new_state):",
              score: 0.8
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === filePath ? { path: rel, content: body } : undefined
    });
    let round = 0;
    const result = await orchestrator.run(
      {
        message: COPILOT_C2_ASK,
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "Users" } });
          }
          if (round === 2) {
            return JSON.stringify({ tool: "read_file", args: { path: filePath } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => {
          streamed += 1;
          return "write_work_item_state in apps/api/issues/work_item_state.py rejects a bad transition.";
        }
      }
    );
    assert.equal(streamed, 1);
    assert.doesNotMatch(result.answer ?? "", /could not find an indexed file/i);
    assert.match(result.answer ?? "", /work_item_state/);
  });

  await test("C1 empty index still posts INDEX_HUNT_MISS", async () => {
    let streamed = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({ source: "zoekt", stale: false, hits: [], symbols: [] })
      }),
      resolveAbsolutePath: () => undefined
    });
    const result = await orchestrator.run(
      {
        message: COPILOT_C1_ASK,
        repoId: "github:raneyja/Coop-AI",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "Bearer" } }),
        streamAnswer: async () => {
          streamed += 1;
          return "should not stream";
        }
      }
    );
    assert.equal(streamed, 0);
    assert.match(result.answer ?? "", /will not guess a path/i);
  });

  console.log(`\nAgentOrchestrator: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
