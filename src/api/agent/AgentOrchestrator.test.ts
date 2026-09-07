import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { IndexBackend } from "../../indexing/indexBackend";
import type { LocalSearchResult } from "../../indexing/types";
import { createAgentOrchestrator, pickTopSearchHit } from "./AgentOrchestrator";
import { COPILOT_C1_ASK, COPILOT_C2_ASK, COPILOT_T2_ASK } from "./dogfoodContract";

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
    assert.match(result.answer ?? "", /usable match/i);
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
    assert.doesNotMatch(result.answer ?? "", /usable match/i);
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
    assert.doesNotMatch(result.answer ?? "", /usable match/i);
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
    assert.doesNotMatch(result.answer ?? "", /usable match/i);
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
    assert.doesNotMatch(result.answer ?? "", /usable match/i);
    assert.match(result.answer ?? "", /work_item_state/);
  });

  await test("C2 auto-reads the hit when the model only searches", async () => {
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
        maxSteps: 4
      },
      {
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "Users" } });
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
    assert.doesNotMatch(result.answer ?? "", /usable match/i);
    assert.ok(
      result.steps.some((s) => s.tool === "read_file" && s.summary.includes(filePath)),
      `expected auto read of ${filePath}, got ${result.steps.map((s) => s.summary).join(" | ")}`
    );
  });

  await test("C2 auto-read prefers API writer over locale and client grouping hits", async () => {
    const filePath = "apps/api/issues/work_item_state.py";
    const body =
      'def write_work_item_state(item, new_state):\n    if not is_valid_transition(item.state, new_state):\n        raise ValueError("cannot move work item out of backlog")\n    item.state = new_state\n';
    const reads: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: "apps/api/issues/seeds/issues.json",
              lineNumber: 3,
              content: '"state_id": 3,',
              score: 0.98
            },
            {
              fileName: "apps/api/issues/serializers/issue.py",
              lineNumber: 2,
              content: "state_detail = StateLiteSerializer(read_only=True, source=\"state\")",
              score: 0.97
            },
            {
              fileName: "apps/api/issues/models/state.py",
              lineNumber: 8,
              content: 'DEFAULT_STATES = [{"name": "Backlog", "group": "backlog"}]',
              score: 0.99
            },
            {
              fileName: "web/components/work-item/commands.ts",
              lineNumber: 10,
              content: "handleUpdateEntity({ state_id: stateId });",
              score: 0.9
            },
            {
              fileName: "web/locales/en/workItem.json",
              lineNumber: 3,
              content: '"cannotMoveOutOfBacklog": "Users cannot move a work item out of backlog"',
              score: 0.99
            },
            {
              fileName: "packages/utils/src/work-item/state.ts",
              lineNumber: 4,
              content: "export function groupWorkItemByState(items) {",
              score: 0.95
            },
            {
              fileName: filePath,
              lineNumber: 12,
              content: "def write_work_item_state(item, new_state):",
              score: 0.35
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        return rel === filePath ? { path: rel, content: body } : { path: rel, content: "noise" };
      }
    });
    let round = 0;
    const result = await orchestrator.run(
      {
        message: COPILOT_C2_ASK,
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "work-item state" } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "write_work_item_state rejects a bad transition."
      }
    );
    const attached = (
      result.context?.read_file as { files?: Array<{ path: string; content: string }> } | undefined
    )?.files
      ?.map((file) => file.content)
      .join("\n") ?? "";
    assert.ok(reads.includes(filePath), `must read the API writer, got ${reads.join(", ")}`);
    assert.match(attached, /write_work_item_state/);
    assert.equal(
      reads.some((p) => /locales|i18n|seeds\//.test(p)),
      false
    );
    assert.ok(
      result.steps.some((s) => s.tool === "read_file" && s.summary.includes(filePath)),
      `expected auto read of ${filePath}, got ${result.steps.map((s) => s.summary).join(" | ")}`
    );
  });

  await test("C2 jumps from a read-only serializer class to validate() in the same file", async () => {
    const filePath = "apps/api/issues/serializers/issue.py";
    const body = [
      "class IssueSerializer:",
      "    def validate(self, data):",
      '        if data.get("state"):',
      '            raise serializers.ValidationError("State is not valid please pass a valid state_id")',
      "",
      "class IssueStateFlatSerializer:",
      "    state_detail = StateLiteSerializer(read_only=True, source=\"state\")"
    ].join("\n");
    const reads: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: filePath,
              lineNumber: 6,
              content: "state_detail = StateLiteSerializer(read_only=True, source=\"state\")",
              score: 0.99
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        return rel === filePath ? { path: rel, content: body } : undefined;
      }
    });
    let round = 0;
    const result = await orchestrator.run(
      {
        message: COPILOT_C2_ASK,
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "work-item state" } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "IssueSerializer.validate rejects an invalid state_id."
      }
    );
    const readFile = result.context?.read_file as
      | { files?: Array<{ path: string; content: string }> }
      | undefined;
    const attached = readFile?.files?.map((file) => file.content).join("\n") ?? "";
    assert.match(attached, /State is not valid/);
    assert.equal(reads.includes(filePath), true);
  });

  await test("C2 model read of a serializer class still jumps to validate()", async () => {
    const filePath = "apps/api/issues/serializers/issue.py";
    const body = [
      "class IssueSerializer:",
      "    def validate(self, data):",
      '        if data.get("state"):',
      '            raise serializers.ValidationError("State is not valid please pass a valid state_id")',
      "",
      "class IssueStateFlatSerializer:",
      "    state_detail = StateLiteSerializer(read_only=True, source=\"state\")"
    ].join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: filePath,
              lineNumber: 6,
              content: "state_detail = StateLiteSerializer(read_only=True, source=\"state\")",
              score: 0.99
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
            return JSON.stringify({ tool: "search_code", args: { query: "work-item state" } });
          }
          if (round === 2) {
            return JSON.stringify({
              tool: "read_file",
              args: { path: filePath, startLine: 6, endLine: 12 }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "IssueSerializer.validate rejects an invalid state_id."
      }
    );
    const attached = (
      result.context?.read_file as { files?: Array<{ content: string }> } | undefined
    )?.files
      ?.map((file) => file.content)
      .join("\n") ?? "";
    assert.match(attached, /State is not valid/);
    assert.doesNotMatch(attached, /Work Item Comments/);
  });

  await test("C2 synthesis conversation excludes OpenAPI and read-only serializer windows", async () => {
    const filePath = "apps/api/plane/app/serializers/issue.py";
    const body = [
      "class IssueSerializer:",
      "    def validate(self, data):",
      '        if data.get("state_id"):',
      '            raise serializers.ValidationError("State is not valid please pass a valid state_id")',
      ...Array.from({ length: 80 }, () => ""),
      "class IssueStateFlatSerializer:",
      "        state_detail = StateLiteSerializer(read_only=True, source=\"state\")"
    ].join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: "apps/api/plane/settings/openapi.py",
              lineNumber: 1,
              content: "Work Items & Tasks",
              score: 0.99
            },
            {
              fileName: filePath,
              lineNumber: 7,
              content: "state_detail = StateLiteSerializer(read_only=True, source=\"state\")",
              score: 0.9
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        if (rel === filePath) {
          return { path: rel, content: body };
        }
        if (rel.includes("openapi")) {
          return { path: rel, content: "Work Items & Tasks\npaths: /api/v1/issues/" };
        }
        return undefined;
      }
    });
    let synthesis = "";
    const result = await orchestrator.run(
      {
        message: COPILOT_C2_ASK,
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => JSON.stringify({ done: true }),
        streamAnswer: async ({ conversation }) => {
          synthesis = conversation.map((m) => m.content).join("\n");
          return "IssueSerializer.validate rejects an invalid state_id.";
        }
      }
    );
    assert.match(synthesis, /State is not valid/);
    assert.doesNotMatch(synthesis, /Work Items & Tasks/);
    assert.doesNotMatch(synthesis, /IssueStateFlatSerializer/);
    const attached = (
      result.context?.read_file as { files?: Array<{ content: string }> } | undefined
    )?.files
      ?.map((file) => file.content)
      .join("\n") ?? "";
    assert.match(attached, /State is not valid/);
    assert.doesNotMatch(attached, /IssueStateFlatSerializer/);
  });

  await test("C2 hunt skips filter converters and attaches serializer validate()", async () => {
    const writerPath = "apps/api/issues/serializers/issue.py";
    const writer = [
      "class IssueSerializer:",
      "    def validate(self, data):",
      '        if data.get("state_id"):',
      '            raise serializers.ValidationError("State is not valid please pass a valid state_id")'
    ].join("\n");
    const converter = [
      "class FilterConverter:",
      "    def _validate_value(self, rich_field_name, value):",
      "        if rich_field_name in self.UUID_FIELDS:",
      "            return self._validate_uuid(value)",
      '        raise ValidationError("Invalid filter value")',
      "        return True"
    ].join("\n");
    const reads: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: "apps/api/plane/utils/filters/converters.py",
              lineNumber: 184,
              content: "def _validate_value(self, rich_field_name: str, value: Any) -> bool:",
              score: 0.99
            },
            {
              fileName: writerPath,
              lineNumber: 4,
              content:
                'raise serializers.ValidationError("State is not valid please pass a valid state_id")',
              score: 0.2
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel === writerPath) {
          return { path: rel, content: writer };
        }
        if (/converters\.py$/.test(rel)) {
          return { path: rel, content: converter };
        }
        return undefined;
      }
    });
    let synthesis = "";
    const result = await orchestrator.run(
      {
        message: COPILOT_C2_ASK,
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => JSON.stringify({ done: true }),
        streamAnswer: async ({ conversation }) => {
          synthesis = conversation.map((m) => m.content).join("\n");
          return "IssueSerializer.validate rejects an invalid state_id.";
        }
      }
    );
    assert.equal(
      reads.some((p) => /filters\/converters/.test(p)),
      false,
      `must not read filter converters, got ${reads.join(", ")}`
    );
    assert.match(synthesis, /State is not valid/);
    assert.doesNotMatch(synthesis, /_validate_value/);
    assert.doesNotMatch(synthesis, /Invalid filter value/);
    const attached = (
      result.context?.read_file as { files?: Array<{ content: string }> } | undefined
    )?.files
      ?.map((file) => file.content)
      .join("\n") ?? "";
    assert.match(attached, /State is not valid/);
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
    assert.match(result.answer ?? "", /usable match/i);
  });

  await test("T2 hunt attaches parent ValidationError, not converters", async () => {
    const writerPath = "apps/api/plane/app/serializers/issue.py";
    const writer = [
      "class IssueSerializer:",
      "    def validate(self, data):",
      '        if data.get("parent"):',
      '            raise serializers.ValidationError("Parent is not valid issue_id")'
    ].join("\n");
    const converter = [
      "class FilterConverter:",
      "    def _validate_value(self, rich_field_name, value):",
      '        raise ValidationError("Invalid filter value")'
    ].join("\n");
    const searches: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          searches.push(query);
          if (/parent is not valid/i.test(query) || /invalid parent/i.test(query)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: writerPath,
                  lineNumber: 4,
                  content:
                    'raise serializers.ValidationError("Parent is not valid issue_id")',
                  score: 0.9
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
                fileName: "apps/api/plane/utils/filters/converters.py",
                lineNumber: 184,
                content: "def _validate_value(self, rich_field_name: str, value: Any) -> bool:",
                score: 0.99
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        if (rel === writerPath) {
          return { path: rel, content: writer };
        }
        if (/converters\.py$/.test(rel)) {
          return { path: rel, content: converter };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: COPILOT_T2_ASK,
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => JSON.stringify({ done: true }),
        streamAnswer: async () =>
          "IssueSerializer.validate rejects a parent that is not a valid issue_id."
      }
    );
    assert.equal(
      searches.some((q) => /parent is not valid/i.test(q)),
      true,
      `T2 must search parent is not valid, got ${searches.join(", ")}`
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /Parent is not valid issue_id/);
    assert.doesNotMatch(result.answer ?? "", /usable match/i);
  });

  await test("API-reject hunt does not answer from a different field's validate()", async () => {
    const htmlPath = "api/serializers/item.py";
    const html = [
      "class ItemCommentSerializer:",
      "    def validate(self, data):",
      '        if "comment_html" in data:',
      '            raise serializers.ValidationError({"comment_html": "HTML content is not valid"})',
      "        return data"
    ].join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: htmlPath,
              lineNumber: 2,
              content: "def validate(self, data):",
              score: 0.99
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === htmlPath ? { path: rel, content: html } : undefined
    });
    const result = await orchestrator.run(
      {
        message: "Where does the API reject a bad parent issue_id?",
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => JSON.stringify({ done: true }),
        streamAnswer: async () => "should not stream a wrong-field validate"
      }
    );
    assert.match(result.answer ?? "", /couldn.t find where the API rejects/i);
    assert.doesNotMatch(result.answer ?? "", /comment_html/);
    assert.doesNotMatch(result.answer ?? "", /casing aliases/i);
  });

  await test("API-reject hunt jumps in-file from a wrong-field validate() to the asked field", async () => {
    const writerPath = "api/serializers/item.py";
    const writer = [
      "class ItemSerializer:",
      "    def validate(self, data):",
      '        if data.get("comment_html"):',
      '            raise serializers.ValidationError({"comment_html": "HTML content is not valid"})',
      '        if data.get("parent"):',
      '            raise serializers.ValidationError("Parent is not valid issue_id")',
      "        return data"
    ].join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: writerPath,
              lineNumber: 3,
              content:
                'raise serializers.ValidationError({"comment_html": "HTML content is not valid"})',
              score: 0.99
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === writerPath ? { path: rel, content: writer } : undefined
    });
    const result = await orchestrator.run(
      {
        message: "Where does the API reject a bad parent issue_id?",
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => JSON.stringify({ done: true }),
        streamAnswer: async () =>
          "validate() rejects a parent that is not a valid issue_id."
      }
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /Parent is not valid issue_id/);
    assert.doesNotMatch(result.answer ?? "", /usable match/i);
  });

  await test("API-reject hunt finds a field raise whose message is not “is not valid”", async () => {
    const htmlPath = "api/serializers/note.py";
    const writerPath = "app/serializers/review.py";
    const html = [
      "class NoteSerializer:",
      "    def validate(self, data):",
      '        if data.get("comment_html"):',
      '            raise serializers.ValidationError({"comment_html": "HTML content is not valid"})',
      "        return data"
    ].join("\n");
    const writer = [
      "class ReviewSerializer:",
      "    def validate(self, data):",
      '        if data.get("reviewer"):',
      '            raise serializers.ValidationError("user not in project")',
      "        return data"
    ].join("\n");
    const ask =
      "A client sent a reviewer that isn’t on the team — the API returns an error. Where does the API reject a bad reviewer_id?";
    const searches: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          searches.push(query);
          if (/get\("reviewer"\)/.test(query) || /^reviewer(_id)?$/i.test(query)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: writerPath,
                  lineNumber: 4,
                  content:
                    'if data.get("reviewer"):\n            raise serializers.ValidationError("user not in project")',
                  score: 0.4
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
                fileName: htmlPath,
                lineNumber: 3,
                content:
                  'raise serializers.ValidationError({"comment_html": "HTML content is not valid"})',
                score: 0.99
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        if (rel === writerPath) {
          return { path: rel, content: writer };
        }
        if (rel === htmlPath) {
          return { path: rel, content: html };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: ask,
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => JSON.stringify({ done: true }),
        streamAnswer: async () =>
          "ReviewSerializer.validate raises when the reviewer is not on the team."
      }
    );
    assert.equal(
      searches.some((q) => /get\("reviewer"\)/.test(q) || /^reviewer(_id)?$/i.test(q)),
      true,
      `must search reviewer access, got ${searches.join(", ")}`
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /user not in project/);
    assert.doesNotMatch(attached, /comment_html/);
    assert.doesNotMatch(result.answer ?? "", /casing aliases/i);
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("API-reject hunt attaches invite email, not a signup email 400", async () => {
    const signupPath = "app/signup_api.py";
    const invitePath = "app/invite_user.py";
    const signup = [
      "export function handleSignup(body) {",
      "  if (!isValidEmail(body.email)) {",
      '    raise ValidationError({"email": "Enter a valid email address."});',
      "  }",
      "}"
    ].join("\n");
    const invite = [
      "export async function inviteUser(input) {",
      "  const email = input.email.trim();",
      "  if (!email) {",
      '    throw new Error("email is required");',
      "  }",
      "}"
    ].join("\n");
    const ask =
      "A client sent an org invite with a blank email — the API returns an error. Where does the API reject a bad email?";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          if (/invite/i.test(query)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: invitePath,
                  lineNumber: 4,
                  content: 'throw new Error("email is required")',
                  score: 0.8
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
                fileName: signupPath,
                lineNumber: 3,
                content: 'raise ValidationError({"email": "Enter a valid email address."})',
                score: 0.99
              },
              {
                fileName: "app/signup_api.test.ts",
                lineNumber: 20,
                content: 'assert.equal(body.error, "invalid_email")',
                score: 0.95
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        if (rel === invitePath) {
          return { path: rel, content: invite };
        }
        if (rel === signupPath) {
          return { path: rel, content: signup };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: ask,
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => JSON.stringify({ done: true }),
        streamAnswer: async () => "inviteUser throws when email is missing."
      }
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ path?: string; content: string }> } | undefined)
        ?.files ?? [];
    assert.equal(
      attached.some((file) => file.path === invitePath),
      true,
      `must attach invite_user, got ${attached.map((file) => file.path).join(", ")}`
    );
    assert.equal(
      attached.some((file) => /signup/i.test(file.path ?? "")),
      false
    );
    assert.match(attached.map((file) => file.content).join("\n"), /email is required/);
    assert.doesNotMatch(result.answer ?? "", /Enter a valid email address/);
  });

  await test("API-reject hunt skips invite callers that rethrow and attaches the email check", async () => {
    const callerPath = "app/org_api.ts";
    const invitePath = "app/invite_user.ts";
    const caller = [
      "    try {",
      "      inviteResult = await inviteUser({ email: adminEmail, role: \"admin\" });",
      "    } catch (error) {",
      "      if (isSeatLimitError(error)) {",
      "        writeJson(response, 403, { error: error.code, seats: error.seats, used: error.used });",
      "        return true;",
      "      }",
      "      throw error;",
      "    }"
    ].join("\n");
    const invite = [
      "export async function inviteUser(input) {",
      "  const email = input.email.trim();",
      "  if (!email) {",
      '    throw new Error("email is required");',
      "  }",
      "}"
    ].join("\n");
    const ask =
      "A client sent an org invite with a blank email — the API returns an error. Where does the API reject a bad email?";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: callerPath,
              lineNumber: 2,
              content: caller,
              score: 0.99
            },
            {
              fileName: invitePath,
              lineNumber: 4,
              content: 'throw new Error("email is required")',
              score: 0.2
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        if (rel === callerPath) {
          return { path: rel, content: caller };
        }
        if (rel === invitePath) {
          return { path: rel, content: invite };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: ask,
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => JSON.stringify({ done: true }),
        streamAnswer: async () => "inviteUser throws when email is missing."
      }
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ path?: string; content: string }> } | undefined)
        ?.files ?? [];
    assert.equal(
      attached.some((file) => file.path === invitePath),
      true,
      `must attach invite_user, got ${attached.map((file) => file.path).join(", ")}`
    );
    assert.equal(
      attached.some((file) => file.path === callerPath),
      false,
      "must not stop on the invite caller rethrow"
    );
    assert.match(attached.map((file) => file.content).join("\n"), /email is required/);
    assert.doesNotMatch(attached.map((file) => file.content).join("\n"), /adminEmail/);
  });

  await test("API-reject hunt jumps in-file from an invite caller to the email 400", async () => {
    const apiPath = "src/server/org_api.ts";
    const filler = Array.from({ length: 40 }, (_, i) => `  const unused${i} = ${i};`).join("\n");
    const body = [
      "    try {",
      "      inviteResult = await inviteUser({ email: adminEmail, role: \"admin\" });",
      "    } catch (error) {",
      "      if (isSeatLimitError(error)) {",
      "        writeJson(response, 403, { error: error.code, seats: error.seats, used: error.used });",
      "        return true;",
      "      }",
      "      throw error;",
      "    }",
      filler,
      "async function handleInviteUser(body, response) {",
      "  const email = String(body.email ?? \"\").trim();",
      "  if (!email) {",
      '    writeJson(response, 400, { error: "email is required" });',
      "    return true;",
      "  }",
      "}"
    ].join("\n");
    const ask =
      "A client sent an org invite with a blank email — the API returns an error. Where does the API reject a bad email?";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: apiPath,
              lineNumber: 2,
              content:
                "inviteResult = await inviteUser({ email: adminEmail, role: \"admin\" });",
              score: 0.99
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        if (rel !== apiPath) {
          return undefined;
        }
        return { path: rel, content: body };
      }
    });
    const result = await orchestrator.run(
      {
        message: ask,
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => JSON.stringify({ done: true }),
        streamAnswer: async () => "The invite handler returns 400 when email is missing."
      }
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ path?: string; content: string }> } | undefined)
        ?.files ?? [];
    const text = attached.map((file) => file.content).join("\n");
    assert.match(text, /email is required/);
    assert.doesNotMatch(text, /throw error/);
  });

  await test("API-reject miss is one pass: no second hunt, no re-read of skipped files", async () => {
    const junk = [
      "api/utils/item_filters.py",
      "web/components/item-chip.tsx",
      "api/db/migrations/0045_props.py"
    ];
    const searches: string[] = [];
    const reads: string[] = [];
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          searches.push(query);
          return {
            source: "zoekt",
            stale: false,
            hits: junk.map((fileName, index) => ({
              fileName,
              lineNumber: 1,
              content: `export const LABEL = "${query}";`,
              score: 0.9 - index * 0.1
            })),
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        return { path: rel, content: 'export const LABEL = "chip";\n' };
      }
    });
    const result = await orchestrator.run(
      {
        message:
          "A client sent a reviewer that isn’t on the team — the API returns an error. Where does the API reject a bad reviewer_id?",
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 8
      },
      {
        planTurn: async () => {
          planTurns += 1;
          return JSON.stringify({ tool: "search_code", args: { query: "reviewer" } });
        },
        streamAnswer: async () => "should not stream after an exhausted hunt"
      }
    );
    assert.equal(planTurns, 0, `must not start a second hunt, planTurns=${planTurns}`);
    assert.equal(
      searches.length,
      new Set(searches.map((q) => q.toLowerCase())).size,
      `must not repeat search queries, got ${searches.join(" | ")}`
    );
    assert.ok(
      reads.length < junk.length * 4,
      `skipped files must not be re-read every query, reads=${reads.length} (${reads.join(", ")})`
    );
    for (const path of junk) {
      const n = reads.filter((r) => r === path).length;
      assert.ok(n <= 3, `${path} re-read ${n} times`);
    }
    assert.match(result.answer ?? "", /couldn.t find where the API rejects/i);
    assert.doesNotMatch(result.answer ?? "", /casing aliases/i);
    assert.doesNotMatch(result.answer ?? "", /should not stream/i);
  });

  console.log(`\nAgentOrchestrator: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
