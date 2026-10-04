import assert from "node:assert/strict";
import { requestedRepoBranch } from "../../workspace/repoTargetResolver";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { IndexBackend } from "../../indexing/indexBackend";
import type { LocalSearchResult } from "../../indexing/types";
import { createAgentOrchestrator, pickTopSearchHit } from "./AgentOrchestrator";
import { COPILOT_C1_ASK, COPILOT_C2_ASK, COPILOT_T2_ASK, LIVE_PARENT_PASS_ASK } from "./dogfoodContract";
import {
  ZOEKT_PARENT_MESSAGE_ONLY,
  PLANE_ISSUE_SERIALIZER_PATH,
  WRONG_FLOOR_HIT_CONTENT,
  loadPlaneIssueSerializerValidateBody,
  assertHitAppearsInFixtureBody
} from "./fixtures/rejectHuntLiveShapes";

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

function latestReadFileContent(
  conversation: Array<{ role: string; content: string }> | undefined,
  filePath: string
): string {
  let latest = "";
  for (const msg of conversation ?? []) {
    if (msg.role !== "user") {
      continue;
    }
    try {
      const parsed = JSON.parse(msg.content) as {
        files?: Array<{ path?: string; content?: string }>;
      };
      for (const file of parsed.files ?? []) {
        if (file.path === filePath && file.content) {
          latest = file.content;
        }
      }
    } catch {
      // Not a read_file payload.
    }
  }
  return latest;
}

function latestContextFile(
  files: Array<{ path: string; content: string }>,
  filePath: string
): { path: string; content: string } | undefined {
  return files.filter((file) => file.path === filePath).at(-1);
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

  await test("calm state locate requires the opened State declaration", async () => {
    const ask = "Where do work-item states live in the backend?";
    const serializerPath = "backend/serializers/state.py";
    const modelPath = "backend/models/state.py";
    const serializerBody = [
      "from backend.models import State",
      "class StateSerializer:",
      "    model = State"
    ].join("\n");
    const modelBody = "class State(BaseModel):\n    name = Field()\n";

    const runCase = async (filePath: string, body: string) => {
      let planCalls = 0;
      let streamed = 0;
      const diagnostics: Array<Record<string, unknown>> = [];
      const orchestrator = createAgentOrchestrator({
        indexBackend: mockIndexBackend({
          search: async () => ({
            source: "zoekt",
            stale: false,
            hits: [{ fileName: filePath, lineNumber: 1, content: body, score: 0.9 }],
            symbols: []
          })
        }),
        resolveAbsolutePath: () => undefined,
        readRemoteFile: async ({ path: rel }) =>
          rel === filePath ? { path: rel, content: body } : undefined
      });
      const result = await orchestrator.run(
        { message: ask, repoId: "acme/demo", action: "locate", maxSteps: 4 },
        {
          planTurn: async () => {
            planCalls += 1;
            if (planCalls === 1) {
              return JSON.stringify({ tool: "search_code", args: { query: "class State" } });
            }
            if (planCalls === 2) {
              return JSON.stringify({ tool: "read_file", args: { path: filePath } });
            }
            return JSON.stringify({ done: true });
          },
          streamAnswer: async () => {
            streamed += 1;
            return `State is defined in ${filePath}.`;
          },
          onDiagnostic: (event) => diagnostics.push(event)
        }
      );
      return { result, streamed, diagnostics };
    };

    const indirect = await runCase(serializerPath, serializerBody);
    assert.equal(indirect.streamed, 0, "serializer import alone must not permit an answer");
    assert.match(indirect.result.answer ?? "", /couldn't find that in this repo/i);

    const grounded = await runCase(modelPath, modelBody);
    assert.equal(grounded.streamed, 1, "the opened model declaration should permit an answer");
    assert.match(grounded.result.answer ?? "", /backend\/models\/state\.py/);
    assert.doesNotMatch(grounded.result.answer ?? "", /urls?\.py|route|routing/i);
    const searchTrace = grounded.diagnostics.find((event) => event.stage === "search");
    assert.ok(searchTrace, "trace should preserve raw and preferred candidate sets");
    assert.equal(searchTrace.rawHitCount, 1);
    assert.deepEqual(searchTrace.preferredHits, [{ path: modelPath, line: 1, score: 0.9 }]);
    const readTrace = grounded.diagnostics.find((event) => event.stage === "candidate-read");
    assert.equal(readTrace?.result, "implementation");
    assert.equal(readTrace?.path, modelPath);
    assert.doesNotMatch(JSON.stringify(grounded.diagnostics), /class State\(BaseModel\)/);
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
    const body = Array.from({ length: 400 }, (_, i) =>
      i === 0 ? "def adapter():" : `line ${i + 1}`
    ).join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            { fileName: "server/auth/adapter.py", lineNumber: 0, content: "def adapter():", score: 1 }
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
    assert.equal(lines[0], "1|def adapter():");
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
    assert.equal(calls, 8);
    assert.ok(result.steps.length >= 8);
  });

  await test("wrong first hit forces a second read before done (dogfood)", async () => {
    const uiPath = "web/components/auth/login-form.tsx";
    const apiPath = "server/auth/middleware.py";
    const reads: string[] = [];
    let round = 0;
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
          return "require_auth is defined in server/auth/middleware.py";
        }
      }
    );
    assert.ok(reads.includes(apiPath), "must read a requireAuth hit before answering");
    assert.match(result.answer ?? "", /middleware\.py/);
    const readSteps = result.steps.filter((s) => s.tool === "read_file");
    assert.ok(readSteps.length >= 1, `expected a read, got ${readSteps.length}`);
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
    assert.match(result.answer ?? "", /couldn't find that in this repo/i);
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
    assert.ok(reads.includes(middlewarePath), "role hits must be auto-read");
    assert.match(result.answer ?? "", /middleware\.py/);
    assert.doesNotMatch(result.answer ?? "", /onAuthenticate/);
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
    let planTurns = 0;
    const result = await orchestrator.run(
      {
        message: "Where does the API reject a bad state transition?",
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "state is not valid" }
            });
          }
          return JSON.stringify({ done: true });
        },
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

  await test("C2 cannot answer from reject evidence alone even without planner evidence labels", async () => {
    const writerPath = "apps/api/plane/app/serializers/issue.py";
    const rejectOnly = [
      "class IssueSerializer:",
      "    def validate(self, data):",
      '        if data.get("state_id"): ',
      '            raise serializers.ValidationError("State is not valid please pass a valid state_id")',
      "        return data"
    ].join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [{
            fileName: writerPath,
            lineNumber: 4,
            content: 'raise serializers.ValidationError("State is not valid please pass a valid state_id")',
            score: 0.99
          }],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === writerPath ? { path: rel, content: rejectOnly } : undefined
    });
    let planTurns = 0;
    let streamed = false;
    const result = await orchestrator.run(
      {
        message: COPILOT_C2_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 3
      },
      {
        planTurn: async () => {
          planTurns += 1;
          return planTurns === 1
            ? JSON.stringify({ tool: "search_code", args: { query: "state is not valid" } })
            : JSON.stringify({ done: true });
        },
        streamAnswer: async () => {
          streamed = true;
          return "The state is written here and invalid transitions are rejected here.";
        }
      }
    );
    assert.equal(streamed, false, "one evidence class must not satisfy the compound completion gate");
    assert.match(result.answer ?? "", /not the state write\/update site/i);
  });

  for (const [label, message] of [
    ["exact", 'In Plane issue create/update on branch preview, the API raises ValidationError "Parent is not valid issue_id please pass a valid issue_id" when the parent is not in the project. Where is that raised?'],
    ["paraphrase", 'In Plane issue create/update, where is ValidationError "Parent is not valid issue_id please pass a valid issue_id" raised when the parent is not in the project?']
  ]) {
    await test(`Parent ${label} lookup does not inherit a state-write gate from the planner brief`, async () => {
      const writerPath = "apps/api/plane/app/serializers/issue.py";
      const body = [
        "class IssueSerializer:",
        "    def validate(self, data):",
        '        if data.get("parent"):',
        '            raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")',
        "    def update(self, instance, validated_data):",
        "        return super().update(instance, validated_data)"
      ].join("\n");
      const orchestrator = createAgentOrchestrator({
        indexBackend: mockIndexBackend({
          search: async () => ({
            source: "zoekt",
            stale: false,
            hits: [{
              fileName: writerPath,
              lineNumber: 3,
                content: 'raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")',
              score: 0.99
            }],
            symbols: []
          })
        }),
        resolveAbsolutePath: () => undefined,
        readRemoteFile: async ({ path: rel }) =>
          rel === writerPath ? { path: rel, content: body } : undefined
      });
      let planTurns = 0;
      let streamed = false;
      const result = await orchestrator.run(
        {
          message,
          repoId: "github:CoopAI-Corp/plane",
          action: "locate",
          maxSteps: 4
        },
        {
          repoTarget: { repoId: "github:CoopAI-Corp/plane", branch: "preview" },
          intentBrief: "- locate evidence=write-site\n- locate evidence=write-reject",
          planTurn: async () => {
            planTurns += 1;
            return planTurns === 1
              ? JSON.stringify({ tool: "search_code", args: { query: "parent is not valid" } })
              : JSON.stringify({ done: true });
          },
          streamAnswer: async ({ conversation }) => {
            streamed = true;
            const evidence = conversation.map((message) => message.content).join("\n");
            assert.match(evidence, /Parent is not valid/);
            return "The serializer rejects an invalid parent in the cited validation guard.";
          }
        }
      );
      assert.equal(streamed, true, `Parent lookup must reach grounded synthesis without requiring state persistence: ${result.answer}`);
      assert.match(result.answer ?? "", /invalid parent/);
      assert.doesNotMatch(result.answer ?? "", /submitted state|transition|update delegation/);
    });
  }

  await test("C2 accepts verified state update delegation alongside its rejection", async () => {
    const writerPath = "apps/api/plane/app/serializers/issue.py";
    const body = [
      "class IssueSerializer:",
      "    def validate(self, data):",
      '        if data.get("state"):',
      '            raise serializers.ValidationError("State is not valid please pass a valid state_id")',
      "    def update(self, instance, validated_data):",
      "        return super().update(instance, validated_data)"
    ].join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [{
            fileName: writerPath,
            lineNumber: 3,
              content: 'return super().update(instance, validated_data)',
            score: 0.99
          }],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === writerPath ? { path: rel, content: body } : undefined
    });
    let planTurns = 0;
    let streamed = false;
    const result = await orchestrator.run(
      {
        message: COPILOT_C2_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        intentBrief: "- locate evidence=write-site\n- locate evidence=write-reject",
        planTurn: async () => {
          planTurns += 1;
          return planTurns === 1
            ? JSON.stringify({ tool: "search_code", args: { query: "state is not valid" } })
            : JSON.stringify({ done: true });
        },
        streamAnswer: async ({ conversation }) => {
          streamed = true;
          const evidence = conversation.map((message) => message.content).join("\n");
          assert.match(evidence, /super\(\)\.update\(instance, validated_data\)/);
          assert.match(evidence, /State is not valid/);
          return "The serializer writes the state and rejects the invalid transition.";
        }
      }
    );
    assert.equal(streamed, false, "verified guard and delegation must survive without a model dropping either proof");
    assert.match(result.answer ?? "", /State is not valid/);
    assert.match(result.answer ?? "", /return super\(\)\.update\(instance, validated_data\)/);
    assert.match(result.answer ?? "", /specific transition described remains unverified/);
  });

  await test("compound hunt preserves the model's later write window after attaching a reject", async () => {
    const path = "server/serializers/item.py";
    const body = [
      'def validate(data):',
      ' if data.get("state_id"):',
      '  raise ValidationError("State is not valid state_id")',
      ...Array.from({ length: 100 }, () => "# padding"),
      'def update(instance, validated_data):',
      ' instance.state = validated_data["state"]',
      ' instance.save()'
    ].join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({ search: async () => ({ source: "zoekt", stale: false, hits: [{ fileName: path, lineNumber: 3, content: 'raise ValidationError("State is not valid state_id")', score: 1 }], symbols: [] }) }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async () => ({ path, content: body })
    });
    let round = 0;
    let streamed = false;
    await orchestrator.run({ message: COPILOT_C2_ASK, repoId: "github:org/repo", action: "locate", maxSteps: 4 }, {
      planTurn: async () => JSON.stringify(++round === 1 ? { tool: "search_code", args: { query: "validate_state" } } : { tool: "read_file", args: { path, startLine: 104, endLine: 108 } }),
      streamAnswer: async ({ conversation }) => {
        const evidence = conversation.map((message) => message.content).join("\n");
        assert.match(evidence, /instance\.state = validated_data/);
        assert.match(evidence, /State is not valid/);
        streamed = true;
        return "State persistence and rejection are attached.";
      }
    });
    assert.equal(streamed, true);
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
    let planTurns = 0;
    const result = await orchestrator.run(
      {
        message: "Where does the API reject a bad state transition?",
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "state is not valid" }
            });
          }
          return JSON.stringify({ done: true });
        },
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
    assert.match(result.answer ?? "", /couldn't find that in this repo/i);
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
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          searches.push(query);
          if (/not valid issue_id|parent is not valid/i.test(query) || /invalid parent/i.test(query)) {
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
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "parent is not valid" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "IssueSerializer.validate rejects a parent that is not a valid issue_id."
      }
    );
    assert.ok(planTurns >= 1, `T2 must use planTurn, got ${planTurns}`);
    assert.equal(
      searches.some((q) => /not valid issue_id|parent is not valid/i.test(q)),
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

  await test("T2 wrong-floor serializer window jumps to parent ValidationError", async () => {
    const writerPath = "apps/api/plane/app/serializers/issue.py";
    const writer = [
      "class IssueSerializer:",
      "    def validate(self, data):",
      '        if data.get("assignee"):',
      '            raise serializers.ValidationError("Assignee is invalid")',
      "        # ... many unrelated lines ...",
      '        if data.get("parent"):',
      '            raise serializers.ValidationError("Parent is not valid please pass a valid issue id")',
      "        return data",
      "",
      "class IssueFlatSerializer:",
      '    parent = serializers.PrimaryKeyRelatedField(read_only=True)'
    ].join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: writerPath,
              lineNumber: 10,
              content: "parent = serializers.PrimaryKeyRelatedField(read_only=True)",
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
    let planTurns = 0;
    const result = await orchestrator.run(
      {
        message: COPILOT_T2_ASK,
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "parent" } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "IssueSerializer.validate rejects a parent that is not a valid issue id."
      }
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /Parent is not valid/);
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("reject hunt: planTurn owns gather — planned criteria are hints, not pre-loop parade", async () => {
    const writerPath = "apps/api/app/serializers/issue.py";
    const writer = [
      "class IssueSerializer:",
      "    def validate(self, data):",
      '        if data.get("parent_id"):',
      '            raise serializers.ValidationError("Parent issue does not belong to the project")',
      "        return data"
    ].join("\n");
    const searches: string[] = [];
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          searches.push(query);
          if (/not valid issue_id|parent is not valid|does not belong to the project|Parent issue does not belong/i.test(query)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: writerPath,
                  lineNumber: 4,
                  content:
                    'raise serializers.ValidationError("Parent issue does not belong to the project")',
                  score: 0.99
                }
              ],
              symbols: []
            };
          }
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === writerPath ? { path: rel, content: writer } : undefined
    });
    const planned = ["Parent issue does not belong to the project"];
    const result = await orchestrator.run(
      {
        message: COPILOT_T2_ASK,
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        plannedSearchQueries: planned,
        intentBrief:
          "Intent quarterback brief (hints only):\n- locate evidence=write-reject seed=[Parent issue does not belong to the project]",
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            // Agent chooses the hinted criterion — not a pre-loop seed.
            return JSON.stringify({
              tool: "search_code",
              args: { query: planned[0] }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "IssueSerializer.validate rejects a parent that does not belong to the project."
      }
    );
    assert.ok(planTurns >= 1, `planTurn must run, got ${planTurns}`);
    assert.equal(searches[0], "Parent is not valid issue_id");
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /does not belong to the project/);
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("C2 ignores locate-only planned criteria and attaches state ValidationError", async () => {
    const writerPath = "apps/api/plane/app/serializers/issue.py";
    const writer = [
      "class IssueSerializer:",
      "    def validate(self, data):",
      '        if data.get("state_id"):',
      '            raise serializers.ValidationError("State is not valid please pass a valid state_id")',
      "        return data"
    ].join("\n");
    const searches: string[] = [];
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          searches.push(query);
          if (/work item state/i.test(query)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: "packages/types/src/collaboration.ts",
                  lineNumber: 40,
                  content: "state?: string;",
                  score: 0.99
                },
                {
                  fileName: "apps/api/plane/utils/issue_filters.py",
                  lineNumber: 80,
                  content: "def filter_state_group(self, queryset, name, value):",
                  score: 0.95
                }
              ],
              symbols: []
            };
          }
          if (/validate_state|state is not valid|ValidationError state|get\("state/i.test(query)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: writerPath,
                  lineNumber: 4,
                  content:
                    'raise serializers.ValidationError("State is not valid please pass a valid state_id")',
                  score: 0.9
                }
              ],
              symbols: []
            };
          }
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === writerPath ? { path: rel, content: writer } : undefined
    });
    const result = await orchestrator.run(
      {
        message: COPILOT_C2_ASK,
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 6
      },
      {
        plannedSearchQueries: ["work item state", "rejects a bad transition"],
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "state is not valid" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "IssueSerializer.validate rejects an invalid state_id for work-item transitions."
      }
    );
    assert.ok(planTurns >= 1);
    assert.equal(
      searches.some((q) => /work item state/i.test(q)),
      false,
      `must not search locate-only planned criteria, got ${searches.join(", ")}`
    );
    assert.ok(
      searches.some((q) => /validate_state|state is not valid|ValidationError state|get\("state/i.test(q)),
      `must search state reject criteria, got ${searches.join(", ")}`
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /State is not valid/);
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("C2 continues past bgtask noise to attach state ValidationError", async () => {
    const writerPath = "apps/api/plane/app/serializers/issue.py";
    const writer = [
      "class IssueSerializer:",
      "    def validate(self, data):",
      '        if data.get("state_id"):',
      '            raise serializers.ValidationError("State is not valid please pass a valid state_id")',
      "        return data"
    ].join("\n");
    const noisePath = "apps/api/plane/bgtasks/analytic_plot_export.py";
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          if (/analytic|bgtask/i.test(query)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: noisePath,
                  lineNumber: 1,
                  content: "def export_analytic_plot():",
                  score: 0.99
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
                fileName: writerPath,
                lineNumber: 4,
                content:
                  'raise serializers.ValidationError("State is not valid please pass a valid state_id")',
                score: 0.9
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
        if (rel === noisePath) {
          return { path: rel, content: "def export_analytic_plot():\n    return None\n" };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: COPILOT_C2_ASK,
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "analytic_plot" } });
          }
          if (planTurns === 2) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "state is not valid" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "IssueSerializer.validate rejects an invalid state_id."
      }
    );
    assert.ok(planTurns >= 2, `must continue after noise, planTurns=${planTurns}`);
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /State is not valid/);
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("UI-only reject evidence yields short miss, not speculative backend essay", async () => {
    const uiPath = "web/components/issues/parent-tag.tsx";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: uiPath,
              lineNumber: 12,
              content: "export function ParentTag() { return null; }",
              score: 0.99
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === uiPath
          ? {
              path: rel,
              content:
                "export function ParentTag() {\n  // client only\n  return <span>parent</span>;\n}\n"
            }
          : undefined
    });
    let planTurns = 0;
    const result = await orchestrator.run(
      {
        message: COPILOT_T2_ASK,
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "parent" } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "The backend serializer probably rejects parent — check IssueSerializer.validate."
      }
    );
    assert.match(result.answer ?? "", /couldn.t (?:find|confirm) where the API rejects/i);
    assert.doesNotMatch(result.answer ?? "", /probably rejects/i);
    assert.doesNotMatch(result.answer ?? "", /IssueSerializer\.validate/i);
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
    let planTurns = 0;
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
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "parent" } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "should not stream a wrong-field validate"
      }
    );
    assert.match(result.answer ?? "", /couldn.t (?:find|confirm) where the API rejects/i);
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
    let planTurns = 0;
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
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "parent" } });
          }
          return JSON.stringify({ done: true });
        },
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
    let planTurns = 0;
    const result = await orchestrator.run(
      {
        message: ask,
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: 'get("reviewer")' } });
          }
          return JSON.stringify({ done: true });
        },
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
    let planTurns = 0;
    const result = await orchestrator.run(
      {
        message: ask,
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            // First hit is signup noise — agent adapts.
            return JSON.stringify({ tool: "search_code", args: { query: "email is required" } });
          }
          if (planTurns === 2) {
            return JSON.stringify({ tool: "search_code", args: { query: "invite email" } });
          }
          return JSON.stringify({ done: true });
        },
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
    let planTurns = 0;
    const result = await orchestrator.run(
      {
        message: ask,
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "email is required" } });
          }
          return JSON.stringify({ done: true });
        },
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
    let planTurns = 0;
    const result = await orchestrator.run(
      {
        message: ask,
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "email is required" } });
          }
          return JSON.stringify({ done: true });
        },
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

  await test("API-reject ask uses planTurn (script brain bypass removed)", async () => {
    const writerPath = "api/serializers/item.py";
    const writer = [
      "class ItemSerializer:",
      "    def validate(self, data):",
      '        if data.get("reviewer_id"):',
      '            raise serializers.ValidationError("reviewer_id is not on the team")',
      "        return data"
    ].join("\n");
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: writerPath,
              lineNumber: 4,
              content: 'raise serializers.ValidationError("reviewer_id is not on the team")',
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
        message:
          "A client sent a reviewer that isn’t on the team — the API returns an error. Where does the API reject a bad reviewer_id?",
        repoId: "github:acme/app",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "reviewer_id ValidationError" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "validate() rejects a reviewer_id that is not on the team."
      }
    );
    assert.ok(planTurns >= 1, `planTurn must run for reject asks, got ${planTurns}`);
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /reviewer_id is not on the team/);
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("API-reject miss goes through planTurn then short miss (no scavenger parade)", async () => {
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
        maxSteps: 4
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "reviewer_id" } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "should not stream after an exhausted hunt"
      }
    );
    assert.ok(planTurns >= 1, `planTurn must run, got ${planTurns}`);
    assert.match(result.answer ?? "", /couldn.t (?:find|confirm) where the API rejects/i);
    assert.doesNotMatch(result.answer ?? "", /casing aliases/i);
    assert.doesNotMatch(result.answer ?? "", /should not stream/i);
  });

  await test("leftover unmatched chip still hunts auth middleware and does not search Jira", async () => {
    const leftover = "src/config/responseDeadline.ts";
    const authPath = "src/server/authMiddleware.ts";
    const reads: string[] = [];
    const vendorCalls: string[] = [];
    let round = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, pattern) => {
          if (/authmiddleware/i.test(pattern)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: authPath,
                  lineNumber: 132,
                  content: "export function requireAuth(request) {",
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
                fileName: leftover,
                lineNumber: 8,
                content: "export const MAX_USER_FACING_RESPONSE_MS = 15_000;",
                score: 0.99
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel === leftover) {
          return {
            path: rel,
            content: "export const MAX_USER_FACING_RESPONSE_MS = 15_000;\nexport function remainingContextGatherBudgetMs() { return 1; }\n"
          };
        }
        if (rel === authPath) {
          return {
            path: rel,
            content:
              "export function requireAuth(request) {\n  return Boolean(request.auth);\n}\n"
          };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: "Where is auth middleware enforced and what calls it?",
        repoId: "github:raneyja/Coop-AI",
        action: "locate",
        openFile: leftover,
        maxSteps: 8
      },
      {
        allowedIntegrations: [],
        searchIntegration: async ({ provider }) => {
          vendorCalls.push(provider);
          return { issues: [{ key: "COOP-55", title: "webview vs native sidebar" }] };
        },
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "read_file", args: { path: leftover } });
          }
          if (round === 2) {
            return JSON.stringify({ tool: "search_code", args: { query: "auth middleware" } });
          }
          if (round === 3) {
            return JSON.stringify({ tool: "search_jira", args: { query: "auth middleware" } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "Auth middleware is requireAuth in src/server/authMiddleware.ts."
      }
    );
    assert.equal(reads.includes(authPath), true, `must read ${authPath}, got ${reads.join(", ")}`);
    assert.equal(
      result.steps.some((step) => step.tool === "search_jira"),
      false,
      "must not execute search_jira on a code-only locate"
    );
    assert.deepEqual(vendorCalls, []);
    assert.doesNotMatch(result.answer ?? "", /couldn't find that in this repo/i);
    assert.doesNotMatch(result.answer ?? "", /open the file/i);
    assert.doesNotMatch(result.answer ?? "", /unused|no call sites|couldn't find any code/i);
  });

  await test("extractBearerToken what-calls-it still reads a caller after the definition window", async () => {
    const authPath = "src/server/authMiddleware.ts";
    const callerPath = "src/server/auth/userAuthApi.ts";
    const defLines = Array.from({ length: 80 }, (_, i) => {
      const line = i + 1;
      if (line === 10) {
        return "export function extractBearerToken(headers) {";
      }
      if (line === 11) {
        return '  const header = headers.authorization ?? "";';
      }
      if (line === 16) {
        return "  return token || undefined;";
      }
      if (line === 17) {
        return "}";
      }
      if (line === 77) {
        return "  const token = extractBearerToken(headers);";
      }
      return `// line ${line}`;
    }).join("\n");
    const reads: Array<{ path: string; startLine?: number; endLine?: number }> = [];
    let round = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: authPath,
              lineNumber: 10,
              content: "export function extractBearerToken(headers) {",
              score: 0.9
            },
            {
              fileName: callerPath,
              lineNumber: 254,
              content: "const token = extractBearerToken(parsed.headers);",
              score: 0.4
            }
          ],
          symbols: [
            {
              symbol: "extractBearerToken",
              kind: "function",
              file: authPath,
              line: 10,
              character: 0,
              displayName: "extractBearerToken"
            }
          ]
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push({ path: rel });
        if (rel === authPath) {
          return { path: rel, content: defLines };
        }
        if (rel === callerPath) {
          return {
            path: rel,
            content: 'import { extractBearerToken } from "../authMiddleware";\nconst token = extractBearerToken(parsed.headers);\n'
          };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: "Where is extractBearerToken defined and what calls it?",
        repoId: "github:raneyja/Coop-AI",
        action: "locate",
        maxSteps: 8
      },
      {
        allowedIntegrations: [],
        planTurn: async () => {
          round += 1;
          if (round === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "extractBearerToken" } });
          }
          if (round === 2) {
            return JSON.stringify({
              tool: "read_file",
              args: { path: authPath, startLine: 10, endLine: 17 }
            });
          }
          if (round === 3) {
            return JSON.stringify({ done: true });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async ({ conversation }) => {
          const blob = JSON.stringify(conversation);
          assert.match(blob, /extractBearerToken\(headers\)/);
          return "extractBearerToken is defined in authMiddleware.ts and called from resolveAuthContext.";
        }
      }
    );
    assert.equal(
      reads.some((read) => read.path === authPath),
      true,
      "must read the definition file"
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files ?? [];
    const text = attached.map((file) => file.content).join("\n");
    assert.match(text, /const token = extractBearerToken\(headers\)/);
    assert.doesNotMatch(result.answer ?? "", /unused|no call sites|currently unused/i);
    assert.doesNotMatch(result.answer ?? "", /couldn't find that in this repo/i);
  });

  await test("requireAuth OR authentication middleware reads plane APIKeyAuthentication (zero model reads)", async () => {
    const authPath = "apps/api/plane/api/middleware/api_authentication.py";
    const reads: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          if (/requireAuth/i.test(query) && !/middleware/i.test(query)) {
            return { source: "zoekt", stale: false, hits: [], symbols: [] };
          }
          return {
            source: "zoekt",
            stale: false,
            hits: [
              {
                fileName: authPath,
                lineNumber: 17,
                content: "class APIKeyAuthentication:",
                score: 0.8
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
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel === authPath) {
          return {
            path: rel,
            content:
              "class APIKeyAuthentication:\n    def authenticate(self, request):\n        return True\n"
          };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: "Where is requireAuth or authentication middleware defined in this repo?",
        repoId: "github:coop-ai/plane",
        action: "locate",
        maxSteps: 6
      },
      {
        allowedIntegrations: [],
        planTurn: async () => {
          return JSON.stringify({ tool: "search_code", args: { query: "requireAuth" } });
        },
        streamAnswer: async () =>
          "Plane authenticates API requests in apps/api/plane/api/middleware/api_authentication.py via APIKeyAuthentication."
      }
    );
    assert.equal(reads.includes(authPath), true, `must auto-read ${authPath}, got ${reads.join(", ")}`);
    assert.doesNotMatch(result.answer ?? "", /couldn't find that in this repo/i);
    assert.doesNotMatch(result.answer ?? "", /open the file/i);
    assert.match(result.answer ?? "", /APIKeyAuthentication|api_authentication/);
  });

  await test("first search story mention then authMiddleware query reads the server", async () => {
    const storyPath = "web/stories/authMiddlewareDemo.ts";
    const serverPath = "src/server/authMiddleware.ts";
    const storyBody = [
      "const AUTH_MIDDLEWARE_STORY = `",
      "func AuthMiddleware(next http.Handler) http.Handler {",
      "  return next",
      "}",
      "// see internal/auth/auth_middleware.go",
      "`;"
    ].join("\n");
    const serverBody = "export function requireAuth(request) {\n  return Boolean(request.auth);\n}\n";
    const reads: string[] = [];
    let streamed = "";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, pattern) => {
          if (/authmiddleware/i.test(pattern)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: serverPath,
                  lineNumber: 132,
                  content: "export function requireAuth(request) {",
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
                fileName: storyPath,
                lineNumber: 4,
                content: "func AuthMiddleware(next http.Handler) http.Handler {",
                score: 0.99
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel === storyPath) {
          return { path: rel, content: storyBody };
        }
        if (rel === serverPath) {
          return { path: rel, content: serverBody };
        }
        return undefined;
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
        allowedIntegrations: [],
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "auth middleware" } }),
        streamAnswer: async ({ conversation }) => {
          streamed = JSON.stringify(conversation);
          assert.doesNotMatch(streamed, /internal\/auth\/auth_middleware\.go/);
          return "Auth middleware is requireAuth in src/server/authMiddleware.ts.";
        }
      }
    );
    assert.equal(reads.includes(serverPath), true, `must read ${serverPath}, got ${reads.join(", ")}`);
    const attached =
      (result.context?.read_file as { files?: Array<{ path: string; content: string }> } | undefined)
        ?.files ?? [];
    assert.equal(
      attached.some((file) => file.path === serverPath),
      true,
      "server body must be attached"
    );
    assert.equal(
      attached.some((file) => /auth_middleware\.go/.test(file.content ?? "")),
      false,
      "must not attach the story body"
    );
    assert.doesNotMatch(result.answer ?? "", /couldn't find that in this repo/i);
    assert.doesNotMatch(result.answer ?? "", /auth_middleware\.go|internal\/auth\//);
  });

  await test("story-only hunt posts INDEX_HUNT_MISS and does not answer from the mention", async () => {
    const storyPath = "web/stories/authMiddlewareDemo.ts";
    const storyBody = [
      "const AUTH_MIDDLEWARE_STORY = `",
      "func AuthMiddleware(next http.Handler) http.Handler {",
      "  return next",
      "}",
      "// see internal/auth/auth_middleware.go",
      "`;"
    ].join("\n");
    let streamed = false;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: storyPath,
              lineNumber: 4,
              content: "func AuthMiddleware(next http.Handler) http.Handler {",
              score: 0.99
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        if (rel === storyPath) {
          return { path: rel, content: storyBody };
        }
        return undefined;
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
        allowedIntegrations: [],
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "auth middleware" } }),
        streamAnswer: async () => {
          streamed = true;
          return "Auth middleware lives in internal/auth/auth_middleware.go.";
        }
      }
    );
    assert.equal(streamed, false, "must not stream a confident answer from the story");
    assert.match(result.answer ?? "", /couldn't find that in this repo/i);
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files ?? [];
    assert.equal(
      attached.some((file) => /auth_middleware\.go/.test(file.content ?? "")),
      false,
      "must not attach the story body"
    );
  });

  await test("role-only what-calls-it reads the server then a handler that uses the export", async () => {
    const storyPath = "web/stories/authMiddlewareDemo.ts";
    const serverPath = "src/server/authMiddleware.ts";
    const callerPath = "src/server/auth/userAuthApi.ts";
    const storyBody = [
      "const AUTH_MIDDLEWARE_STORY = `",
      "func AuthMiddleware(next http.Handler) http.Handler {",
      "  return next",
      "}",
      "// see internal/auth/auth_middleware.go",
      "`;"
    ].join("\n");
    const serverBody = "export function requireAuth(request) {\n  return Boolean(request.auth);\n}\n";
    const callerBody = [
      'import { requireAuth } from "../authMiddleware";',
      "export function handleLogin(req) {",
      "  if (!requireAuth(req.auth, true)) return;",
      "}"
    ].join("\n");
    const reads: string[] = [];
    const searches: string[] = [];
    let streamed = "";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, pattern) => {
          searches.push(pattern);
          if (/requireAuth|require_auth/i.test(pattern)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: serverPath,
                  lineNumber: 1,
                  content: "export function requireAuth(request) {",
                  score: 0.9
                },
                {
                  fileName: callerPath,
                  lineNumber: 3,
                  content: "if (!requireAuth(req.auth, true)) return;",
                  score: 0.8
                }
              ],
              symbols: []
            };
          }
          if (/authmiddleware/i.test(pattern)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: serverPath,
                  lineNumber: 1,
                  content: "export function requireAuth(request) {",
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
                fileName: storyPath,
                lineNumber: 4,
                content: "func AuthMiddleware(next http.Handler) http.Handler {",
                score: 0.99
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel === storyPath) {
          return { path: rel, content: storyBody };
        }
        if (rel === serverPath) {
          return { path: rel, content: serverBody };
        }
        if (rel === callerPath) {
          return { path: rel, content: callerBody };
        }
        return undefined;
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
        allowedIntegrations: [],
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "auth middleware" } }),
        streamAnswer: async ({ conversation }) => {
          streamed = JSON.stringify(conversation);
          assert.doesNotMatch(streamed, /internal\/auth\/auth_middleware\.go/);
          return "Auth middleware is requireAuth in src/server/authMiddleware.ts and handleLogin in src/server/auth/userAuthApi.ts calls it.";
        }
      }
    );
    assert.equal(reads.includes(serverPath), true, `must read server, got ${reads.join(", ")}`);
    assert.equal(reads.includes(callerPath), true, `must read a caller, got ${reads.join(", ")}`);
    assert.equal(
      searches.some((query) => /requireAuth|require_auth/i.test(query)),
      true,
      `caller hunt must search the export, got ${searches.join(" | ")}`
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ path: string; content: string }> } | undefined)
        ?.files ?? [];
    assert.equal(
      attached.some((file) => file.path === serverPath),
      true,
      "server body must be attached"
    );
    assert.equal(
      attached.some((file) => file.path === callerPath),
      true,
      "caller body must be attached"
    );
    assert.equal(
      attached.some((file) => /auth_middleware\.go/.test(file.content ?? "")),
      false,
      "must not attach the story body"
    );
    assert.doesNotMatch(result.answer ?? "", /couldn't find that in this repo/i);
    assert.doesNotMatch(result.answer ?? "", /auth_middleware\.go|internal\/auth\//);
    assert.ok(
      reads.indexOf(serverPath) < reads.indexOf(callerPath),
      "matchingRead (server) must happen before callerRead (handler)"
    );
  });

  await test("role-only what-calls-it without a caller still cites the implementation", async () => {
    const serverPath = "src/server/authMiddleware.ts";
    const serverBody = "export function requireAuth(request) {\n  return Boolean(request.auth);\n}\n";
    const searches: string[] = [];
    let streamed = "";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, pattern) => {
          searches.push(pattern);
          if (/requireAuth|require_auth|authmiddleware/i.test(pattern)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: serverPath,
                  lineNumber: 1,
                  content: "export function requireAuth(request) {",
                  score: 0.9
                }
              ],
              symbols: []
            };
          }
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        if (rel === serverPath) {
          return { path: rel, content: serverBody };
        }
        return undefined;
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
        allowedIntegrations: [],
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "auth middleware" } }),
        streamAnswer: async ({ conversation }) => {
          streamed = JSON.stringify(conversation);
          assert.doesNotMatch(streamed, /userAuthApi|auth_middleware\.go|internal\/auth\//);
          return "Auth middleware is requireAuth in src/server/authMiddleware.ts. Callers were not found in the index.";
        }
      }
    );
    assert.doesNotMatch(result.answer ?? "", /couldn't find that in this repo/i);
    assert.doesNotMatch(result.answer ?? "", /userAuthApi|auth_middleware\.go|internal\/auth\//);
    assert.match(result.answer ?? "", /requireAuth/);
    assert.doesNotMatch(streamed, /userAuthApi/);
    assert.equal(
      searches.some((query) => /requireAuth|require_auth/i.test(query)),
      true,
      `must still search the export, got ${searches.join(" | ")}`
    );
  });

  await test("story mention must not become callerRead", async () => {
    const storyPath = "web/stories/authMiddlewareDemo.ts";
    const serverPath = "src/server/authMiddleware.ts";
    const storyBody = [
      "const AUTH_MIDDLEWARE_STORY = `",
      "func AuthMiddleware(next http.Handler) http.Handler {",
      "  return next",
      "}",
      "// see internal/auth/auth_middleware.go",
      "`;"
    ].join("\n");
    const serverBody = "export function requireAuth(request) {\n  return Boolean(request.auth);\n}\n";
    const reads: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, pattern) => {
          if (/requireAuth|require_auth/i.test(pattern)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: storyPath,
                  lineNumber: 4,
                  content: "func AuthMiddleware(next http.Handler) http.Handler {",
                  score: 0.99
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
                fileName: serverPath,
                lineNumber: 1,
                content: "export function requireAuth(request) {",
                score: 0.9
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel === storyPath) {
          return { path: rel, content: storyBody };
        }
        if (rel === serverPath) {
          return { path: rel, content: serverBody };
        }
        return undefined;
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
        allowedIntegrations: [],
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "auth middleware" } }),
        streamAnswer: async ({ conversation }) => {
          assert.doesNotMatch(JSON.stringify(conversation), /auth_middleware\.go/);
          return "Auth middleware is requireAuth in src/server/authMiddleware.ts. Callers were not found in the index.";
        }
      }
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ path: string; content: string }> } | undefined)
        ?.files ?? [];
    assert.equal(
      attached.some((file) => file.path === serverPath),
      true,
      "server implementation must still be attached"
    );
    assert.equal(
      attached.some((file) => file.path === storyPath || /auth_middleware\.go/.test(file.content ?? "")),
      false,
      "story must not attach as a caller"
    );
    assert.doesNotMatch(result.answer ?? "", /couldn't find that in this repo/i);
    assert.doesNotMatch(result.answer ?? "", /auth_middleware\.go|internal\/auth\//);
  });

  await test("H1 requireAuth defined does not require a caller read", async () => {
    const serverPath = "src/server/authMiddleware.ts";
    const callerPath = "src/server/auth/userAuthApi.ts";
    const reads: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: serverPath,
              lineNumber: 1,
              content: "export function requireAuth(request) {",
              score: 0.9
            },
            {
              fileName: callerPath,
              lineNumber: 3,
              content: "if (!requireAuth(req.auth, true)) return;",
              score: 0.8
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel === serverPath) {
          return {
            path: rel,
            content: "export function requireAuth(request) {\n  return Boolean(request.auth);\n}\n"
          };
        }
        if (rel === callerPath) {
          return {
            path: rel,
            content:
              'import { requireAuth } from "../authMiddleware";\nexport function handleLogin(req) {\n  if (!requireAuth(req.auth, true)) return;\n}\n'
          };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: "Where is requireAuth defined in this repo?",
        repoId: "acme/demo",
        action: "locate",
        maxSteps: 6
      },
      {
        allowedIntegrations: [],
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "requireAuth" } }),
        streamAnswer: async () => "requireAuth is exported from src/server/authMiddleware.ts."
      }
    );
    assert.equal(reads.includes(serverPath), true, `must read the definition, got ${reads.join(", ")}`);
    assert.equal(reads.includes(callerPath), false, "H1 must not require a caller read");
    assert.doesNotMatch(result.answer ?? "", /couldn't find that in this repo/i);
    assert.match(result.answer ?? "", /requireAuth/);
  });

  await test("role-only what-calls-it uses requireAuth from the full file, not the top window", async () => {
    const serverPath = "src/server/authMiddleware.ts";
    const callerPath = "src/server/http/handlers.py";
    const defLines = Array.from({ length: 160 }, (_, i) => {
      const line = i + 1;
      if (line === 10) {
        return "export function extractBearerToken(headers) {";
      }
      if (line === 17) {
        return "}";
      }
      if (line === 46) {
        return "export async function resolveAuthContextDetailed(headers) {";
      }
      if (line === 50) {
        return "}";
      }
      if (line === 132) {
        return "export function requireAuth(auth, requireInProduction) {";
      }
      if (line === 136) {
        return "}";
      }
      return `// line ${line}`;
    }).join("\n");
    const callerBody = [
      "from server.http.middleware import require_auth",
      "def handle_login(request):",
      "    return require_auth(request)"
    ].join("\n");
    const reads: string[] = [];
    const searches: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, pattern) => {
          searches.push(pattern);
          if (/^requireAuth$|^require_auth$/i.test(pattern)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: serverPath,
                  lineNumber: 132,
                  content: "export function requireAuth(auth, requireInProduction) {",
                  score: 0.9
                },
                {
                  fileName: callerPath,
                  lineNumber: 3,
                  content: "return require_auth(request)",
                  score: 0.8
                }
              ],
              symbols: []
            };
          }
          if (/resolveAuthContextDetailed|extractBearerToken|requireInstallAdmin/i.test(pattern)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: serverPath,
                  lineNumber: 10,
                  content: "export function extractBearerToken(headers) {",
                  score: 0.7
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
                fileName: serverPath,
                lineNumber: 10,
                content: "export function extractBearerToken(headers) {",
                score: 0.95
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel === serverPath) {
          return { path: rel, content: defLines };
        }
        if (rel === callerPath) {
          return { path: rel, content: callerBody };
        }
        return undefined;
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
        allowedIntegrations: [],
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "auth middleware" } }),
        streamAnswer: async ({ conversation }) => {
          const blob = JSON.stringify(conversation);
          assert.match(blob, /requireAuth|require_auth/);
          assert.doesNotMatch(blob, /callers were not found in the index/i);
          const implAttach = latestReadFileContent(conversation, serverPath);
          assert.match(implAttach, /requireAuth/);
          assert.doesNotMatch(
            implAttach,
            /extractBearerToken/,
            "writer implementation body must be the gate window, not page 1"
          );
          assert.doesNotMatch(implAttach, /^1\|/m);
          const callerAttach = latestReadFileContent(conversation, callerPath);
          assert.match(callerAttach, /require_auth\(request\)/);
          return "Auth middleware is requireAuth; handle_login in src/server/http/handlers.py calls it.";
        }
      }
    );
    assert.equal(reads.includes(serverPath), true, `must read the implementation, got ${reads.join(", ")}`);
    assert.equal(reads.includes(callerPath), true, `must read a caller of requireAuth, got ${reads.join(", ")}`);
    assert.equal(
      searches.some((query) => /^requireAuth$|^require_auth$/i.test(query)),
      true,
      `must search the requireAuth export, got ${searches.join(" | ")}`
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ path: string; content: string }> } | undefined)
        ?.files ?? [];
    assert.equal(
      attached.some((file) => file.path === callerPath),
      true,
      "caller body must be attached"
    );
    const latestImpl = latestContextFile(attached, serverPath);
    assert.ok(latestImpl, "implementation body must be attached");
    assert.match(latestImpl.content, /requireAuth/);
    assert.doesNotMatch(latestImpl.content, /extractBearerToken/);
    assert.doesNotMatch(latestImpl.content, /^1\|/m);
    assert.equal(
      attached.filter((file) => file.path === serverPath).length,
      1,
      "writer should see one implementation body, not the top window plus the full file"
    );
    assert.ok(
      latestImpl.content.split("\n").length < 120,
      "jumped implementation window must not be the full 160-line file"
    );
    const latestCaller = latestContextFile(attached, callerPath);
    assert.match(latestCaller?.content ?? "", /require_auth\(request\)/);
    assert.doesNotMatch(result.answer ?? "", /couldn't find that in this repo/i);
    assert.doesNotMatch(result.answer ?? "", /callers were not found/i);
  });

  await test("role-only Card 1 attach jumps to the gate export, not page 1", async () => {
    const serverPath = "src/server/authMiddleware.ts";
    const callerPath = "src/server/http/handlers.py";
    const defLines = Array.from({ length: 160 }, (_, i) => {
      const line = i + 1;
      if (line === 10) {
        return "export function extractBearerToken(headers) {";
      }
      if (line === 17) {
        return "}";
      }
      if (line === 46) {
        return "export async function resolveAuthContextDetailed(headers) {";
      }
      if (line === 50) {
        return "}";
      }
      if (line === 132) {
        return "export function requireAuth(auth, requireInProduction) {";
      }
      if (line === 136) {
        return "}";
      }
      return `// line ${line}`;
    }).join("\n");
    const callerBody = Array.from({ length: 90 }, (_, i) => {
      const line = i + 1;
      if (line === 1) {
        return "# HTTP handlers";
      }
      if (line === 83) {
        return "from server.http.middleware import require_auth";
      }
      if (line === 84) {
        return "def handle_login(request):";
      }
      if (line === 85) {
        return "    return require_auth(request)";
      }
      return `# line ${line}`;
    }).join("\n");
    const reads: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, pattern) => {
          if (/^requireAuth$|^require_auth$/i.test(pattern)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: serverPath,
                  lineNumber: 132,
                  content: "export function requireAuth(auth, requireInProduction) {",
                  score: 0.9
                },
                {
                  fileName: callerPath,
                  lineNumber: 1,
                  content: "return require_auth(request)",
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
                fileName: serverPath,
                lineNumber: 10,
                content: "export function extractBearerToken(headers) {",
                score: 0.95
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel === serverPath) {
          return { path: rel, content: defLines };
        }
        if (rel === callerPath) {
          return { path: rel, content: callerBody };
        }
        return undefined;
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
        allowedIntegrations: [],
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "auth middleware" } }),
        streamAnswer: async ({ conversation }) => {
          const implAttach = latestReadFileContent(conversation, serverPath);
          assert.match(implAttach, /requireAuth/);
          assert.doesNotMatch(implAttach, /extractBearerToken/);
          assert.doesNotMatch(implAttach, /^1\|/m);
          const callerAttach = latestReadFileContent(conversation, callerPath);
          assert.match(callerAttach, /require_auth\(request\)/);
          assert.doesNotMatch(callerAttach, /^1\|# HTTP handlers/m);
          return "Auth middleware is requireAuth; handle_login calls it.";
        }
      }
    );
    assert.equal(reads.includes(serverPath), true);
    assert.equal(reads.includes(callerPath), true);
    const attached =
      (result.context?.read_file as { files?: Array<{ path: string; content: string }> } | undefined)
        ?.files ?? [];
    const latestImpl = latestContextFile(attached, serverPath);
    assert.match(latestImpl?.content ?? "", /requireAuth/);
    assert.doesNotMatch(latestImpl?.content ?? "", /extractBearerToken/);
    const latestCaller = latestContextFile(attached, callerPath);
    assert.match(latestCaller?.content ?? "", /require_auth\(request\)/);
    assert.doesNotMatch(result.answer ?? "", /couldn't find that in this repo/i);
  });

  const SHIP_CHECK_ASK =
    "If I change that missing-key response, what else in this repo should I check before I ship?";

  await test("ship-check search hits do not answer until a sibling 401 body is read", async () => {
    const serverPath = "src/server/authMiddleware.ts";
    const siblingPath = "src/jobs/jobsApi.ts";
    const serverBody = "export function requireAuth(request) {\n  return Boolean(request.auth);\n}\n";
    const reads: string[] = [];
    let rounds = 0;
    let streamed = "";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: serverPath,
              lineNumber: 1,
              content: "export function requireAuth(request) {",
              score: 0.9
            },
            {
              fileName: siblingPath,
              lineNumber: 40,
              content: 'writeJson(response, 401, { error: "unauthorized" });',
              score: 0.8
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel === serverPath) {
          return { path: rel, content: serverBody };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: SHIP_CHECK_ASK,
        repoId: "acme/demo",
        action: "locate",
        maxSteps: 8,
        openFile: serverPath
      },
      {
        allowedIntegrations: [],
        planTurn: async () => {
          rounds += 1;
          if (rounds === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "missing-key" } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async ({ conversation }) => {
          streamed = JSON.stringify(conversation);
          return "I could not open other call sites.";
        }
      }
    );
    assert.ok(rounds > 2, `done after search-only would be ${rounds} rounds`);
    assert.match(streamed, /could not open other call sites|callers were not found/i);
    const attached =
      (result.context?.read_file as { files?: Array<{ path: string; content: string }> } | undefined)
        ?.files ?? [];
    assert.equal(
      attached.some(
        (file) => file.path === siblingPath && /unauthorized/.test(file.content ?? "")
      ),
      false,
      "must not treat a path-only sibling hit as a ripple"
    );
  });

  await test("ship-check reads sibling 401 writers and tests, not path-only hits", async () => {
    const serverPath = "src/server/authMiddleware.ts";
    const siblingPath = "src/jobs/jobsApi.ts";
    const testPath = "src/server/orgApi.test.ts";
    const serverBody = "export function requireAuth(request) {\n  return Boolean(request.auth);\n}\n";
    const siblingPad = Array.from({ length: 60 }, (_, i) => `const pad${i} = ${i};`).join("\n");
    const siblingBody = `${siblingPad}\nexport function handleJobsApiRequest(req, res) {\n  if (!auth) {\n    writeJson(res, 401, { error: "unauthorized" });\n    return;\n  }\n}\n`;
    const testBody =
      'test("missing key", () => {\n  assert.equal(json.error, "unauthorized");\n});\n';
    const reads: string[] = [];
    let streamed = "";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: serverPath,
              lineNumber: 1,
              content: "export function requireAuth(request) {",
              score: 0.95
            },
            {
              fileName: siblingPath,
              lineNumber: 63,
              content: 'writeJson(res, 401, { error: "unauthorized" });',
              score: 0.9
            },
            {
              fileName: testPath,
              lineNumber: 2,
              content: 'assert.equal(json.error, "unauthorized");',
              score: 0.7
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        if (rel === serverPath) {
          return { path: rel, content: serverBody };
        }
        if (rel === siblingPath) {
          return { path: rel, content: siblingBody };
        }
        if (rel === testPath) {
          return { path: rel, content: testBody };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: SHIP_CHECK_ASK,
        repoId: "acme/demo",
        action: "locate",
        maxSteps: 8,
        openFile: serverPath
      },
      {
        allowedIntegrations: [],
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "unauthorized" } }),
        streamAnswer: async ({ conversation }) => {
          streamed = JSON.stringify(conversation);
          return "jobsApi.ts writes the same unauthorized 401; orgApi.test.ts asserts that shape.";
        }
      }
    );
    assert.ok(reads.includes(siblingPath), `must read sibling writer, got ${reads.join(", ")}`);
    assert.ok(reads.includes(testPath), `must read ship-check tests, got ${reads.join(", ")}`);
    assert.match(streamed, /writeJson/);
    assert.match(streamed, /unauthorized/);
    const attached =
      (result.context?.read_file as { files?: Array<{ path: string; content: string }> } | undefined)
        ?.files ?? [];
    assert.equal(
      attached.some(
        (file) => file.path === siblingPath && /writeJson[\s\S]*unauthorized/.test(file.content ?? "")
      ),
      true,
      "sibling 401 body must be attached"
    );
    assert.equal(
      attached.some((file) => file.path === testPath && /unauthorized/.test(file.content ?? "")),
      true,
      "test body must be attached"
    );
    assert.doesNotMatch(result.answer ?? "", /couldn't find that in this repo/i);
  });



  await test("search snippet without a remote body cannot pass the Parent reject evidence gate", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    // Live: Fragments[].Match is the query span — Parent may not be in the hit content.
    const matchOnly = "is not valid issue_id please pass a valid issue_id";
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: "apps/web/components/issues/parent-tag.tsx",
              lineNumber: 1,
              content: "export function ParentTag() {}",
              score: 0.99
            },
            {
              fileName: writerPath,
              lineNumber: 186,
              content: matchOnly,
              score: 0.5
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async () => undefined
    });
    const result = await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async ({ round }) => {
          if (round === 0) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "Parent is not valid issue_id" }
            });
          }
          // Later overwrite search — finish must still attach from ledger.
          if (round === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "issue_id" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "Parent ValidationError in serializers/issue.py."
      }
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string; evidenceSource?: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /is not valid issue_id please pass a valid issue_id/);
    const files = (result.context?.read_file as { files?: Array<{ evidenceSource?: string }> } | undefined)?.files ?? [];
    assert.ok(files.some((file) => file.evidenceSource === "search-snippet"));
    assert.match(result.answer ?? "", /couldn.t (?:find|confirm) where the API rejects/i);
  });

  await test("search-hit ValidationError does not pass without a remote body read", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    const ask = LIVE_PARENT_PASS_ASK;
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: writerPath,
              lineNumber: 186,
              // Live Zoekt: often only the message line — no raise / ValidationError.
              content: ZOEKT_PARENT_MESSAGE_ONLY,
              score: 0.99
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      // Live Fail: search hits the raise line, body fetch returns nothing.
      readRemoteFile: async () => undefined
    });
    const result = await orchestrator.run(
      {
        message: ask,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "Parent is not valid issue_id" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "IssueCreateSerializer.validate raises Parent is not valid issue_id."
      }
    );
    assert.ok(planTurns >= 1);
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string; evidenceSource?: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /Parent is not valid issue_id please pass a valid issue_id/);
    const files = (result.context?.read_file as { files?: Array<{ evidenceSource?: string }> } | undefined)?.files ?? [];
    assert.ok(files.some((file) => file.evidenceSource === "search-snippet"));
    assert.match(result.answer ?? "", /couldn.t (?:find|confirm) where the API rejects/i);
  });

  await test("search-hit message-only snippet does not pass Parent reject without a remote read", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    let planTurns = 0;
    let searchCount = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => {
          searchCount += 1;
          return {
            source: "zoekt",
            stale: false,
            hits: [
              {
                fileName: writerPath,
                lineNumber: 186,
                content: ZOEKT_PARENT_MESSAGE_ONLY,
                score: 0.99
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async () => undefined
    });
    const result = await orchestrator.run(
      {
        message: COPILOT_T2_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 6
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "parent issue_id" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "API rejects bad parent issue_id in IssueCreateSerializer.validate."
      }
    );
    assert.ok(planTurns >= 1);
    assert.ok(searchCount >= 1 && searchCount <= 4, `expected few searches, got ${searchCount}`);
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string; evidenceSource?: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /Parent is not valid issue_id please pass a valid issue_id/);
    const files = (result.context?.read_file as { files?: Array<{ evidenceSource?: string }> } | undefined)?.files ?? [];
    assert.ok(files.some((file) => file.evidenceSource === "search-snippet"));
    assert.match(result.answer ?? "", /couldn.t (?:find|confirm) where the API rejects/i);
  });

  await test("reject attaches from raw hits when preferredHits emptied by noise", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    let readCount = 0;
    let searchCount = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => {
          searchCount += 1;
          return {
            source: "zoekt",
            stale: false,
            hits: [
              {
                fileName: "apps/web/components/issues/parent-tag.tsx",
                lineNumber: 10,
                content: "export function ParentTag() { return null }",
                score: 0.95
              },
              {
                fileName: writerPath,
                lineNumber: 186,
                content: ZOEKT_PARENT_MESSAGE_ONLY,
                score: 0.4
              }
            ],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async () => {
        readCount += 1;
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 8
      },
      {
        planTurn: async ({ round }) => {
          if (round === 0) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "Parent is not valid issue_id" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "Parent ValidationError in serializers/issue.py."
      }
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /Parent is not valid issue_id please pass a valid issue_id/);
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
    assert.ok(searchCount < 8, `must not search-parade; got ${searchCount}`);
  });

  await test("finish cannot miss while unused asked-field hit sits in search context", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: writerPath,
              lineNumber: 186,
              content: ZOEKT_PARENT_MESSAGE_ONLY,
              score: 0.99
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async () => undefined
    });
    const result = await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 3
      },
      {
        // Lazy agent: one search then immediate done — rails must attach before miss.
        planTurn: async ({ round }) => {
          if (round === 0) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "Parent is not valid" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "should not stream miss essay"
      }
    );
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /Parent is not valid issue_id/);
  });

  await test("wrong-branch body without Parent still attaches from message-only hit", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    const wrongBranchBody = [
      "class IssueCreateSerializer(BaseSerializer):",
      "    def validate(self, data):",
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
              lineNumber: 186,
              content: ZOEKT_PARENT_MESSAGE_ONLY,
              score: 0.99
            }
          ],
          symbols: []
        })
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) =>
        rel === writerPath ? { path: rel, content: wrongBranchBody } : undefined
    });
    const result = await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async ({ round }) => {
          if (round === 0) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "Parent is not valid issue_id" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "Parent ValidationError attached from index hit."
      }
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /Parent is not valid issue_id please pass a valid issue_id/);
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("planTurn present does not resurrect huntWriteReject on invalid first plan", async () => {
    let deterministicSearches = 0;
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => {
          deterministicSearches += 1;
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async () => undefined
    });
    await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 3
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return "not json at all — invalid plan";
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "miss ok after gather"
      }
    );
    assert.ok(planTurns >= 2, "must continue planTurn loop, not scavenger");
    // Finish last-chance quote is fail-open rails (≤ a few). huntWriteReject scavenger is ≥12.
    assert.ok(
      deterministicSearches <= 8,
      `huntWriteReject/scavenger must not run when planTurn present; got ${deterministicSearches} searches`
    );
  });

  await test("reject adaptation: round-2 tool depends on round-1 preferredHits", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    const writer = loadPlaneIssueSerializerValidateBody();
    const tools: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: writerPath,
              lineNumber: 40,
              content: WRONG_FLOOR_HIT_CONTENT,
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
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 5
      },
      {
        planTurn: async ({ lastToolResult, round }) => {
          if (round === 0) {
            tools.push("search_code");
            return JSON.stringify({
              tool: "search_code",
              args: { query: "IssueCreateSerializer" }
            });
          }
          // Round 2 must react to preferredHits / attached results — read, not spray.
          const hasPreferred =
            typeof lastToolResult === "string" && /preferredHits|IssueCreateSerializer/i.test(lastToolResult);
          if (hasPreferred || round === 1) {
            tools.push("read_file");
            return JSON.stringify({
              tool: "read_file",
              args: { path: writerPath }
            });
          }
          tools.push("done");
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "Parent reject in IssueCreateSerializer.validate."
      }
    );
    assert.ok(tools.includes("search_code"));
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /Parent is not valid issue_id please pass a valid issue_id/);
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("live Plane issue.py wrong-floor hit jumps to Parent ValidationError", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    const writer = loadPlaneIssueSerializerValidateBody();
    assertHitAppearsInFixtureBody(WRONG_FLOOR_HIT_CONTENT);
    const ask = LIVE_PARENT_PASS_ASK;
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async () => ({
          source: "zoekt",
          stale: false,
          hits: [
            {
              fileName: writerPath,
              lineNumber: 12,
              content: WRONG_FLOOR_HIT_CONTENT,
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
        message: ask,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "Parent is not valid issue_id" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "IssueCreateSerializer.validate raises Parent is not valid issue_id."
      }
    );
    assert.ok(planTurns >= 1);
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string }> } | undefined)?.files
        ?.map((file) => file.content)
        .join("\n") ?? "";
    assert.match(attached, /Parent is not valid issue_id please pass a valid issue_id/);
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("Gate A fidelity: planned Parent hunt leads with the exact quote and adds no finish search parade", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    const body = loadPlaneIssueSerializerValidateBody();
    const searches: string[] = [];
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repoId: string, pattern: string) => {
          searches.push(pattern);
          const q = pattern.toLowerCase();
          if (q.includes("parent is not valid") || q.includes("not valid issue_id") || q.includes("please pass a valid issue_id")) {
            return { source: "zoekt", stale: false, hits: [], symbols: [] };
          }
          if (q === "validationerror" || (q.includes("validationerror") && !q.includes("parent"))) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: "apps/api/plane/utils/error_codes.py",
                  lineNumber: 12,
                  content: "class ErrorCode: VALIDATION_ERROR = ...",
                  score: 0.9
                }
              ],
              symbols: []
            };
          }
          if (q === "issue_id") {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: "apps/web/components/issues/issue-id.tsx",
                  lineNumber: 1,
                  content: "export function IssueIdBadge() { return null }",
                  score: 0.99
                }
              ],
              symbols: []
            };
          }
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      searchCodeHost: async ({ query: hostQ }) => {
        if (/Parent is not valid issue_id/i.test(hostQ)) {
          return [{ path: writerPath }];
        }
        return [];
      },
      findFiles: async () => [],
      readRemoteFile: async ({ path: filePath }) => {
        if (filePath.includes("serializers/issue.py") || filePath === writerPath) {
          return { path: filePath, content: body };
        }
        if (filePath.includes("error_codes")) {
          return { path: filePath, content: "class ErrorCode:\n    VALIDATION_ERROR = 'x'\n" };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 8
      },
      {
        // Adversarial model: leads with issue_id / ValidationError then done.
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "issue_id" } });
          }
          if (planTurns === 2) {
            return JSON.stringify({ tool: "search_code", args: { query: "ValidationError" } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "Raised in IssueCreateSerializer.validate — Parent is not valid issue_id."
      }
    );
    assert.ok(planTurns > 1, "the planner owns the gather rounds");
    assert.equal(
      searches[0],
      "Parent is not valid issue_id please pass a valid issue_id",
      `first search must be the exact quote: ${searches.join(" | ")}`
    );
    assert.match(result.answer ?? "", /IssueCreateSerializer\.validate/);
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("live Parent Fail: invent draft twin must follow to issue create serializer", async () => {
    const draftPath = "apps/api/plane/app/serializers/draft.py";
    const issuePath = PLANE_ISSUE_SERIALIZER_PATH;
    const draftBody = [
      "from .issue import IssueCreateSerializer",
      "class IssueDraftSerializer:",
      "    def validate(self, data):",
      '        raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")',
      "        return data"
    ].join("\n");
    const issueBody = loadPlaneIssueSerializerValidateBody();
    const reads: string[] = [];
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repoId: string, pattern: string) => {
          const q = pattern.toLowerCase();
          if (q.includes("parent is not valid") || q.includes("not valid issue_id")) {
            return { source: "zoekt", stale: false, hits: [], symbols: [] };
          }
          // Planner refinement should target the create/update serializer directly.
          if (q.includes("issuecreateserializer")) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: issuePath,
                  lineNumber: 186,
                  content:
                    'raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")',
                  score: 0.99
                }
              ],
              symbols: []
            };
          }
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      searchCodeHost: async () => [],
      findFiles: async () => [],
      readRemoteFile: async ({ path: filePath }) => {
        reads.push(filePath);
        if (filePath === draftPath) {
          return { path: filePath, content: draftBody };
        }
        if (filePath === issuePath || /serializers\/issue\.py/i.test(filePath)) {
          return { path: filePath, content: issueBody };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 4
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "Parent is not valid issue_id please pass a valid issue_id" }
            });
          }
          if (planTurns === 2) {
            return JSON.stringify({ tool: "search_code", args: { query: "IssueCreateSerializer" } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "Raised in IssueCreateSerializer.validate — Parent is not valid issue_id."
      }
    );
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
    const attached =
      (result.context?.read_file as { files?: Array<{ path?: string; content: string }> } | undefined)
        ?.files ?? [];
    const blob = attached.map((file) => `${file.path ?? ""}\n${file.content}`).join("\n");
    assert.match(blob, /Parent is not valid issue_id/);
    assert.ok(
      attached.some((file) => /issue\.py/i.test(file.path ?? "")) ||
        /IssueCreateSerializer/i.test(blob),
      `create/update site must be attached, not only draft; paths=${attached.map((f) => f.path).join(",")}`
    );
  });

  await test("live Parent Fail: wrong __init__/urls opens must not skip invent → attach", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    const body = loadPlaneIssueSerializerValidateBody();
    const initPath = "apps/api/plane/app/serializers/__init__.py";
    const urlsPath = "apps/api/plane/app/urls/issue.py";
    const searches: string[] = [];
    const reads: string[] = [];
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repoId: string, pattern: string) => {
          searches.push(pattern);
          const q = pattern.toLowerCase();
          if (q.includes("parent is not valid") || q.includes("not valid issue_id") || q.includes("please pass a valid")) {
            return { source: "zoekt", stale: false, hits: [], symbols: [] };
          }
          // Agent noise: issue_id ValidationError → barrel + urls (live Fail).
          if (q.includes("issue_id") && q.includes("validationerror")) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: initPath,
                  lineNumber: 1,
                  content: "from .issue import IssueCreateSerializer",
                  score: 0.99
                },
                {
                  fileName: urlsPath,
                  lineNumber: 10,
                  content: "path('issues/', IssueViewSet)",
                  score: 0.9
                }
              ],
              symbols: []
            };
          }
          if (q.includes("class issuecreateserializer") || q.includes("issuecreateserializer")) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: writerPath,
                  lineNumber: 1,
                  content: "class IssueCreateSerializer(BaseSerializer):",
                  score: 0.99
                }
              ],
              symbols: [
                {
                  symbol: "IssueCreateSerializer",
                  kind: "class",
                  file: writerPath,
                  line: 1,
                  character: 0,
                  displayName: "IssueCreateSerializer"
                }
              ]
            };
          }
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      searchCodeHost: async () => [],
      findFiles: async () => [],
      readRemoteFile: async ({ path: filePath }) => {
        reads.push(filePath);
        if (filePath === writerPath || filePath.includes("serializers/issue.py")) {
          return { path: filePath, content: body };
        }
        if (filePath === initPath) {
          return {
            path: filePath,
            content: "from .issue import IssueCreateSerializer\n"
          };
        }
        if (filePath === urlsPath) {
          return {
            path: filePath,
            content: "from plane.app.views import IssueViewSet\nurlpatterns = []\n"
          };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 7
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "Parent is not valid issue_id please pass a valid issue_id" }
            });
          }
          if (planTurns === 2) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "Parent is not valid" }
            });
          }
          if (planTurns === 3) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: 'issue_id ValidationError' }
            });
          }
          if (planTurns === 4) {
            return JSON.stringify({
              tool: "read_file",
              args: { path: initPath }
            });
          }
          if (planTurns === 5) {
            return JSON.stringify({
              tool: "read_file",
              args: { path: urlsPath }
            });
          }
          if (planTurns === 6) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "IssueCreateSerializer" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "Raised in IssueCreateSerializer.validate — Parent is not valid issue_id."
      }
    );
    assert.ok(
      searches.some((q) => /IssueCreateSerializer/i.test(q)),
      `the planner must refine to the serializer after wrong opens, got ${searches.join(" | ")}`
    );
    assert.ok(
      reads.some((path) => /serializers\/issue\.py/i.test(path)),
      `must read issue serializer, not only __init__/urls; got ${reads.join(", ")}`
    );
    assert.doesNotMatch(
      result.answer ?? "",
      /couldn.t find where the API rejects/i,
      "must not canned-miss after __init__/urls burn (live 1:58 Fail)"
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string; path?: string }> } | undefined)
        ?.files ?? [];
    const blob = attached.map((file) => `${file.path ?? ""}\n${file.content}`).join("\n");
    assert.match(blob, /Parent is not valid issue_id/);
  });

  await test("live Parent Fail shape: planner refines quote misses to IssueCreateSerializer", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    const body = loadPlaneIssueSerializerValidateBody();
    const searches: string[] = [];
    const reads: string[] = [];
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repoId: string, pattern: string) => {
          searches.push(pattern);
          const q = pattern.toLowerCase();
          // Live: Exact quote + variants absent from Lightning.
          if (
            q.includes("parent is not valid") ||
            q.includes("not valid issue_id") ||
            q.includes("please pass a valid") ||
            q === "parent is not valid"
          ) {
            return { source: "zoekt", stale: false, hits: [], symbols: [] };
          }
          if (q.includes("validationerror") && !q.includes("issuecreateserializer")) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: "apps/api/plane/utils/error_codes.py",
                  lineNumber: 12,
                  content: "class ErrorCode: VALIDATION_ERROR = ...",
                  score: 0.9
                }
              ],
              symbols: []
            };
          }
          // Finish invent must search this — Lightning has the symbol.
          if (q.includes("issuecreateserializer") || q === "issueserializer") {
            return {
              source: "zoekt",
              stale: false,
              hits: [],
              symbols: [
                {
                  symbol: "IssueCreateSerializer",
                  kind: "class",
                  file: writerPath,
                  line: 1,
                  character: 0,
                  displayName: "IssueCreateSerializer"
                }
              ]
            };
          }
          if (q.includes("validate_parent")) {
            return { source: "zoekt", stale: false, hits: [], symbols: [] };
          }
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      searchCodeHost: async () => [],
      findFiles: async () => [],
      readRemoteFile: async ({ path: filePath }) => {
        reads.push(filePath);
        if (filePath.includes("serializers/issue.py") || filePath === writerPath) {
          return { path: filePath, content: body };
        }
        if (filePath.includes("error_codes")) {
          return { path: filePath, content: "class ErrorCode:\n    VALIDATION_ERROR = 'x'\n" };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 6
      },
      {
        // Exact live Fail: planner first tries quote / ValidationError, then refines.
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "Parent is not valid issue_id please pass a valid issue_id" }
            });
          }
          if (planTurns === 2) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "Parent is not valid issue_id" }
            });
          }
          if (planTurns === 3) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: 'ValidationError "issue_id"' }
            });
          }
          if (planTurns === 4) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "IssueCreateSerializer" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "Raised in IssueCreateSerializer.validate — Parent is not valid issue_id."
      }
    );
    assert.ok(
      searches.some((q) => /IssueCreateSerializer|IssueSerializer|validate_parent/i.test(q)),
      `planner should search the ask-derived symbol after quote miss, got ${searches.join(" | ")}`
    );
    assert.ok(
      reads.some((path) => /serializers\/issue\.py/i.test(path)),
      `must read serializer body, got ${reads.join(", ")}`
    );
    assert.doesNotMatch(
      result.answer ?? "",
      /couldn.t find where the API rejects/i,
      "must not canned-miss — this is the live Parent Fail class"
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string; path?: string }> } | undefined)
        ?.files ?? [];
    const blob = attached.map((file) => `${file.path ?? ""}\n${file.content}`).join("\n");
    assert.match(blob, /Parent is not valid issue_id/);
  });

  await test("live Parent shape: agent invents symbol search after empty quote (no body-scan rail)", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    const body = loadPlaneIssueSerializerValidateBody();
    const searches: string[] = [];
    let planTurns = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repoId: string, pattern: string) => {
          searches.push(pattern);
          const q = pattern.toLowerCase();
          if (q.includes("parent is not valid") || q.includes("not valid issue_id") || q.includes("please pass a valid")) {
            return { source: "zoekt", stale: false, hits: [], symbols: [] };
          }
          if (q.includes("issuecreateserializer") || q.includes("issueserializer")) {
            return {
              source: "zoekt",
              stale: false,
              hits: [],
              symbols: [
                {
                  symbol: "IssueCreateSerializer",
                  kind: "class",
                  file: writerPath,
                  line: 1,
                  character: 0,
                  displayName: "IssueCreateSerializer"
                }
              ]
            };
          }
          if (q.includes("validationerror")) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: "apps/api/plane/utils/error_codes.py",
                  lineNumber: 12,
                  content: "class ErrorCode: VALIDATION_ERROR = ...",
                  score: 0.9
                }
              ],
              symbols: []
            };
          }
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      searchCodeHost: async () => [],
      findFiles: async () => [],
      readRemoteFile: async ({ path: filePath }) => {
        if (filePath.includes("serializers/issue.py") || filePath === writerPath) {
          return { path: filePath, content: body };
        }
        if (filePath.includes("error_codes")) {
          return { path: filePath, content: "class ErrorCode:\n    VALIDATION_ERROR = 'x'\n" };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 10
      },
      {
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "ValidationError" } });
          }
          if (planTurns === 2) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: '"Parent is not valid issue_id"' }
            });
          }
          // Agent invents from ask create/update — not a foresight body-scan rail.
          if (planTurns === 3) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "IssueCreateSerializer" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "Raised in IssueCreateSerializer.validate — Parent is not valid issue_id."
      }
    );
    assert.ok(planTurns >= 3, `agent must adapt with a third search, got ${planTurns}`);
    assert.ok(
      searches.some((q) => /IssueCreateSerializer|IssueSerializer/i.test(q)),
      `expected agent-invented symbol search, got ${searches.join(" | ")}`
    );
    assert.doesNotMatch(
      result.answer ?? "",
      /couldn.t find where the API rejects/i,
      "must not canned-miss when agent opens serializer with Parent quote"
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ content: string; path?: string }> } | undefined)
        ?.files ?? [];
    const blob = attached.map((file) => `${file.path ?? ""}\n${file.content}`).join("\n");
    assert.match(blob, /Parent is not valid issue_id/);
    assert.match(blob, /serializers\/issue\.py|issue\.py/);
  });

  await test("multi-hit: weak twin attach does not freeze when ask job unmatched and budget left", async () => {
    const draftPath = "apps/api/plane/app/serializers/draft.py";
    const issuePath = "apps/api/plane/app/serializers/issue.py";
    const draftBody = [
      "class IssueDraftSerializer:",
      "    def validate(self, data):",
      '        raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")',
      "        return data"
    ].join("\n");
    const issueBody = [
      "class IssueCreateSerializer:",
      "    def validate(self, data):",
      '        raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")',
      "        return data"
    ].join("\n");
    let planTurns = 0;
    const searches: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          searches.push(query);
          if (/draft/i.test(query)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: draftPath,
                  lineNumber: 3,
                  content:
                    'raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")',
                  score: 0.99
                }
              ],
              symbols: []
            };
          }
          if (/IssueCreateSerializer|create/i.test(query)) {
            return {
              source: "zoekt",
              stale: false,
              hits: [
                {
                  fileName: issuePath,
                  lineNumber: 3,
                  content:
                    'raise serializers.ValidationError("Parent is not valid issue_id please pass a valid issue_id")',
                  score: 0.95
                }
              ],
              symbols: []
            };
          }
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        if (rel === draftPath) {
          return { path: rel, content: draftBody };
        }
        if (rel === issuePath) {
          return { path: rel, content: issueBody };
        }
        return undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 6
      },
      {
        startedAt: Date.now(),
        wallMs: 60_000,
        planTurn: async () => {
          planTurns += 1;
          if (planTurns === 1) {
            return JSON.stringify({ tool: "search_code", args: { query: "draft parent" } });
          }
          // After weak draft attach, loop must continue (not freeze) so this runs.
          if (planTurns === 2) {
            return JSON.stringify({
              tool: "search_code",
              args: { query: "IssueCreateSerializer" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () =>
          "IssueCreateSerializer.validate raises Parent is not valid issue_id on create/update."
      }
    );
    assert.ok(
      planTurns >= 2,
      `must continue after weak twin attach, planTurns=${planTurns}`
    );
    const attached =
      (result.context?.read_file as { files?: Array<{ path?: string; content: string }> } | undefined)
        ?.files ?? [];
    const blob = attached.map((file) => `${file.path ?? ""}\n${file.content}`).join("\n");
    assert.match(blob, /IssueCreateSerializer|Parent is not valid/);
    assert.ok(
      attached.some((file) => /issue\.py/i.test(file.path ?? "")) ||
        /IssueCreateSerializer/.test(blob),
      `create/update site should be on shortlist, got paths=${attached.map((f) => f.path).join(",")}`
    );
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("Parent paraphrase consumes the serializer candidate and jumps to the reject", async () => {
    const writerPath = PLANE_ISSUE_SERIALIZER_PATH;
    const searches: string[] = [];
    const reads: string[] = [];
    const events: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          searches.push(query);
          events.push("search");
          return {
            source: "zoekt",
            stale: false,
            hits: [{
              fileName: writerPath,
              lineNumber: 20,
              content: WRONG_FLOOR_HIT_CONTENT,
              score: 0.95
            }],
            symbols: []
          };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: rel }) => {
        reads.push(rel);
        events.push("read");
        return rel === writerPath
          ? { path: rel, content: loadPlaneIssueSerializerValidateBody() }
          : undefined;
      }
    });
    const result = await orchestrator.run(
      {
        message: COPILOT_T2_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 8
      },
      {
        intentBrief: "- locate evidence=write-reject",
        planTurn: async ({ round }) => round === 0
          ? JSON.stringify({ tool: "search_code", args: { query: "parent_issue_id" } })
          : JSON.stringify({ done: true }),
        streamAnswer: async () => "The Parent reject is in IssueCreateSerializer.validate."
      }
    );
    const files =
      (result.context?.read_file as { files?: Array<{ path?: string; content: string }> } | undefined)
        ?.files ?? [];
    const evidence = files.map((file) => `${file.path ?? ""}\n${file.content}`).join("\n");
    assert.ok(reads.includes(writerPath), `expected remote read of ${writerPath}`);
    assert.match(evidence, /Parent is not valid issue_id please pass a valid issue_id/);
    const toolTrace = result.steps.map((step) => step.tool);
    const firstToolSearch = toolTrace.indexOf("search_code");
    const nextToolSearch = toolTrace.indexOf("search_code", firstToolSearch + 1);
    const firstToolRead = toolTrace.indexOf("read_file");
    assert.ok(
      nextToolSearch < 0 || firstToolRead < nextToolSearch,
      `candidate must be read before a follow-up tool search: ${toolTrace.join(" → ")} (${events.join(" → ")})`
    );
    assert.doesNotMatch(result.answer ?? "", /couldn.t find where the API rejects/i);
  });

  await test("planned reject hunt caps at one seed plus four empty refinements", async () => {
    const searches: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          searches.push(query);
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async () => undefined
    });
    const result = await orchestrator.run(
      {
        message: COPILOT_C2_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 10
      },
      {
        planTurn: async ({ round }) => JSON.stringify({
          tool: "search_code",
          args: { query: `state transition ${round}` }
        }),
        streamAnswer: async () => ""
      }
    );
    assert.equal(searches.length, 5, `expected one seed plus four refinements, got ${searches.length}: ${searches.join(" | ")}`);
    assert.equal(
      result.steps.filter((step) => step.tool === "read_file").length,
      0,
      "no reads should be claimed when the index returned no candidates"
    );
    assert.match(result.answer ?? "", /indexed searches yielded no attachable reject snippet/i);
  });

  await test("repeated reject searches require a new criterion without another network call", async () => {
    const searches: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({ search: async (_repo, query) => {
        searches.push(query);
        return { source: "zoekt", stale: false, hits: [], symbols: [] };
      } }), resolveAbsolutePath: () => undefined, readRemoteFile: async () => undefined
    });
    await orchestrator.run({ message: "Where does the server reject an invalid document status for signing?", repoId: "remote:repeat-fixture", action: "locate", maxSteps: 4 }, {
      planTurn: async ({ round, lastToolResult }) => {
        if (round === 2) assert.match(lastToolResult ?? "", /already searched/);
        return round === 3 ? JSON.stringify({ done: true })
          : JSON.stringify({ tool: "search_code", args: { query: round < 2 ? "signField" : "validateDocument" } });
      }, streamAnswer: async () => ""
    });
    assert.deepEqual(searches, ["signField", "sign_field", "validateDocument", "validate_document"]);
  });

  await test("domain-status reject preserves the model's handler search", async () => {
    const searches: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({ search: async (_repo, query) => {
        searches.push(query);
        return { source: "zoekt", stale: false, hits: [], symbols: [] };
      } }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async () => undefined
    });
    await orchestrator.run({
      message: "A signer gets an error that the document must be pending for signing. Where does the server reject this request, and what status check enforces it?",
      repoId: "remote:status-fixture", action: "locate", maxSteps: 2
    }, {
      planTurn: async ({ round }) => round === 0
        ? JSON.stringify({ tool: "search_code", args: { query: "signDocument" } })
        : JSON.stringify({ done: true }),
      streamAnswer: async () => ""
    });
    assert.equal(searches[0], "signDocument");
  });

  await test("reject first search uses exact quote before the planner's generic query", async () => {
    const searches: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          searches.push(query);
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async () => undefined
    });
    await orchestrator.run(
      {
        message: LIVE_PARENT_PASS_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 2
      },
      {
        planTurn: async ({ round }) => round === 0
          ? JSON.stringify({ tool: "search_code", args: { query: "parent_issue_id" } })
          : JSON.stringify({ done: true }),
        streamAnswer: async () => ""
      }
    );
    assert.equal(
      searches[0],
      "Parent is not valid issue_id please pass a valid issue_id",
      `first reject search must use the exact quoted error, got ${searches.join(" | ")}`
    );
  });

  await test("reject first search uses ask-derived transition criteria before generic intent terms", async () => {
    const searches: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({
        search: async (_repo, query) => {
          searches.push(query);
          return { source: "zoekt", stale: false, hits: [], symbols: [] };
        }
      }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async () => undefined
    });
    await orchestrator.run(
      {
        message: COPILOT_C2_ASK,
        repoId: "github:CoopAI-Corp/plane",
        action: "locate",
        maxSteps: 2
      },
      {
        plannedSearchQueries: ["work item", "backlog", "IntakeWorkItem"],
        intentBrief: "Generic locate intent; no reject query criteria.",
        planTurn: async ({ round }) => round === 0
          ? JSON.stringify({ tool: "search_code", args: { query: "work item" } })
          : JSON.stringify({ done: true }),
        streamAnswer: async () => ""
      }
    );
    assert.equal(
      searches[0],
      "validate_state",
      `first reject search must use ask-derived transition criteria, got ${searches.join(" | ")}`
    );
  });

  await test("agent readRemoteFile wiring keeps resolveActiveRepoTarget (branch parity)", async () => {
    const extensionSrc = fs.readFileSync(path.join(__dirname, "../../extension.ts"), "utf8");
    assert.match(extensionSrc, /readRemoteFile:\s*async/);
    assert.match(extensionSrc, /resolveActiveRepoTarget/);
    assert.match(extensionSrc, /searchCodeHost:\s*async/);
    assert.match(extensionSrc, /searchRepositoryCodeContent/);
    const readRemoteBlock = extensionSrc.slice(
      extensionSrc.indexOf("readRemoteFile: async"),
      extensionSrc.indexOf("findFiles: async")
    );
    assert.match(readRemoteBlock, /resolveActiveRepoTarget/);
    assert.match(readRemoteBlock, /workspace\.readFile\(target/);
    const filenameFallback = extensionSrc.slice(
      extensionSrc.indexOf("const runTreeFallback"),
      extensionSrc.indexOf("const treeHits = await searchFilesViaCloudTree")
    );
    assert.match(filenameFallback, /api\.graphSearch\(baseUrl, repoId, query/);
    assert.doesNotMatch(filenameFallback, /scope:|collectionId:|resolveSearchScopeForPlan/);
    const cloudFileSearch = extensionSrc.slice(
      extensionSrc.indexOf("const cloudCodeHostSearchFetcher"),
      extensionSrc.indexOf("const cloudCodeHostBlameFetcher")
    );
    assert.match(cloudFileSearch, /if \(hits\.length === 0 \|\| excludeClientUi\)\s*\{/);
  });

  await test("remote filtering method corrects a reject premise and survives synthesis compaction", async () => {
    const query = "A client sent an assignee that isn’t on the team — the API returns an error. Where does the API reject a bad assignee_id?";
    const writerPath = "apps/api/plane/api/serializers/issue.py";
    const method = fs.readFileSync(path.join(__dirname, "fixtures/plane-issue-validate-preview.py"), "utf8").split("\n").slice(6).join("\n");
    const body = "\n".repeat(74) + method;
    let networkReads = 0;
    let streamed = false;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({ search: async () => ({ source: "zoekt", stale: false,
        hits: [{ fileName: writerPath, lineNumber: 107, content: 'data["assignees"] = ProjectMember.objects.filter(', score: 0.95 }], symbols: [] }) }),
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: filePath }) => { networkReads++; return { path: filePath, content: body }; }
    });
    const result = await orchestrator.run({ message: query, repoId: "github:CoopAI-Corp/plane", action: "locate" }, {
      planTurn: async ({ round }) => round === 0 ? JSON.stringify({ tool: "search_code", args: { query: "assignee_id" } }) : JSON.stringify({ done: true }),
      streamAnswer: async ({ conversation }) => {
        const attached = JSON.stringify(conversation);
        assert.match(attached, /ProjectMember.objects.filter/);
        assert.match(attached, /return data/);
        assert.match(attached, /correct that premise/);
        streamed = true; return "The shown method filters submitted assignees through active project membership.";
      }
    });
    assert.equal(streamed, false, "Verified filtering answers use exact source, without speculative synthesis");
    assert.equal(networkReads, 1, "Complete method windows reuse the same remotely fetched body");
    assert.match(result.answer ?? "", /filters the submitted `assignees`/);
    assert.match(result.answer ?? "", /source of the reported error remains unverified/);
    assert.match(result.answer ?? "", /108:113:apps\/api\/plane\/api\/serializers\/issue.py/);
    assert.doesNotMatch(result.answer ?? "", /must come from|coming from another|108\|/);
    assert.match(JSON.stringify(result.context?.read_file), /75\|.*def validate/);
    assert.match(JSON.stringify(result.context?.read_file), /149\|.*return data/);
  });

  await test("explicit branch scope keeps ref spelling without treating code branches as refs", () => {
    assert.equal(requestedRepoBranch("On indexed branch `feature/parent-guard` of fixture, locate validate."), "feature/parent-guard");
    assert.equal(requestedRepoBranch("From the branch release/v2.1, show the implementation."), "release/v2.1");
    assert.equal(requestedRepoBranch("What does this branch condition return?"), undefined);
    assert.equal(requestedRepoBranch("Where is fixtureBranchLabel defined?"), undefined);
  });

  await test("explicit branch questions never read a different refreshed indexed branch", async () => {
    let searches = 0;
    let reads = 0;
    let planned = false;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({ search: async () => { searches++; throw new Error("Wrong-branch search"); } }),
      resolveAbsolutePath: () => undefined,
      resolveRepoTarget: async (target) => ({ ...target, branch: "alternate" }),
      readRemoteFile: async () => { reads++; throw new Error("Wrong-branch read"); }
    });
    const result = await orchestrator.run({ repoId: "github:org/fixture", action: "locate",
      message: "On indexed branch main of fixture, what exact string does fixtureBranchLabel return?" }, {
      repoTarget: { repoId: "github:org/fixture", branch: "main" },
      planTurn: async () => { planned = true; return JSON.stringify({ done: true }); }
    });
    assert.equal(searches, 0);
    assert.equal(reads, 0);
    assert.equal(planned, false);
    assert.equal(result.context, undefined);
    assert.match(result.answer ?? "", /asked about branch `main`/);
    assert.match(result.answer ?? "", /indexed workspace is on `alternate`/);
  });

  await test("target resolution hands off without an unverified ref and respects user Stop", async () => {
    let searches = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({ search: async () => { searches++; return { source: "fallback", hits: [], symbols: [], stale: false }; } }),
      resolveAbsolutePath: () => undefined,
      resolveRepoTarget: async () => new Promise(() => {})
    });
    const controller = new AbortController();
    const result = await orchestrator.run({ message: "Where is verifyToken defined?", repoId: "github:org/repo" }, {
      startedAt: Date.now() - 8_990, signal: controller.signal,
      repoTarget: { repoId: "github:org/repo", branch: "preview" }
    });
    assert.equal(controller.signal.aborted, false);
    assert.equal(searches, 0);
    assert.equal(result.context, undefined);
    assert.match(result.answer ?? "", /couldn’t verify the selected repository and branch/);
    const stopped = new AbortController();
    const pending = orchestrator.run({ message: "Where is verifyToken defined?", repoId: "github:org/repo" }, { signal: stopped.signal });
    stopped.abort();
    assert.deepEqual(await pending, { steps: [], context: undefined });
  });

  await test("compound filtering evidence never claims an actual rejection was found", async () => {
    const writerPath = "server/serializers/task.py";
    const body = [
      "def validate(self, data):",
      '    data["state"] = State.objects.filter(id__in=data["state"]).values_list("id", flat=True)',
      "    return data",
      "", "def update(self, instance, validated_data):",
      '    instance.state = validated_data.get("state")',
      "    return super().update(instance, validated_data)"
    ].join("\n");
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({ search: async () => ({ source: "zoekt", stale: false,
        hits: [{ fileName: writerPath, lineNumber: 1, content: body, score: 1 }], symbols: [] }) }),
      resolveAbsolutePath: () => undefined, readRemoteFile: async ({ path: filePath }) => ({ path: filePath, content: body })
    });
    const result = await orchestrator.run({ message: "The API rejects a bad state_id. Find where state is rejected and where state is written.", repoId: "github:org/repo", action: "locate", maxSteps: 2 }, {
      planTurn: async ({ round }) => round === 0 ? JSON.stringify({ tool: "search_code", args: { query: "state_id" } }) : JSON.stringify({ done: true }),
      streamAnswer: async () => { throw new Error("Incomplete rejection evidence cannot synthesize an affirmative rejection"); }
    });
    assert.doesNotMatch(result.answer ?? "", /found the server-side state rejection/i);
    assert.match(result.answer ?? "", /does not establish the claimed rejection/);
  });

  await test("slow tool planning hands verified source to synthesis without cancelling the answer", async () => {
    const controller = new AbortController();
    const diagnostics: Record<string, unknown>[] = [];
    let answerCalls = 0;
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend(), resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: filePath }) => ({ path: filePath, content: "export function verifyToken() { return true; }" })
    });
    const result = await orchestrator.run({ message: "Where is verifyToken defined?", repoId: "github:org/repo", action: "locate" }, {
      startedAt: Date.now() - 8_700, signal: controller.signal,
      onDiagnostic: (event) => diagnostics.push(event),
      planTurn: async ({ round }) => round === 0 ? JSON.stringify({ tool: "search_code", args: { query: "verifyToken" } }) : new Promise(() => {}),
      streamAnswer: async ({ conversation }) => {
        answerCalls++;
        assert.match(JSON.stringify(conversation), /export function verifyToken/);
        return "verifyToken is defined in src/auth.ts.";
      }
    });
    assert.equal(controller.signal.aborted, false);
    assert.equal(answerCalls, 1);
    assert.match(result.answer ?? "", /verifyToken is defined/);
    assert.ok(diagnostics.some((event) => event.stage === "gather-handoff" && event.waitingStage === "tool-plan"));
  });

  await test("locate synthesis excludes unopened search excerpts and planning guesses", async () => {
    const parserPath = "server/auth/middleware.ts";
    const body = 'export function extractBearerToken(headers) {\n  const token = headers.authorization.slice(7).trim();\n  return token || undefined;\n}';
    const orchestrator = createAgentOrchestrator({
      indexBackend: mockIndexBackend({ search: async () => ({ source: "embedding", stale: false, hits: [
        { fileName: "server/auth/authTokenStore.ts", lineNumber: 1, content: "export class AuthTokenStore {}", score: 0.9 },
        { fileName: parserPath, lineNumber: 1, content: body, score: 0.4 },
        { fileName: "ops/unopened.ts", lineNumber: 1, content: "UNVERIFIED_SEARCH_EXCERPT", score: 0.3 }
      ], symbols: [] }) }), resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path: filePath }) => ({ path: filePath, content: filePath === parserPath ? body : "export class AuthTokenStore {}" })
    });
    const result = await orchestrator.run({ message: "Where do we parse the Authorization Bearer token? Point me at the existing function.", repoId: "github:org/repo", action: "locate" }, {
      planTurn: async ({ round }) => round === 0 ? JSON.stringify({ tool: "search_code", args: { query: "Authorization Bearer" } }) : JSON.stringify({ done: true }),
      streamAnswer: async ({ conversation }) => {
        const transcript = JSON.stringify(conversation);
        assert.match(transcript, /extractBearerToken/);
        assert.match(transcript, /trim/);
        assert.doesNotMatch(transcript, /UNVERIFIED_SEARCH_EXCERPT|authTokenStore|ops\/unopened/);
        return "The opened parser is extractBearerToken.";
      }
    });
    assert.match(result.answer ?? "", /opened parser/);
  });

  await test("compound handoff reuses the complete same-class remote update, never a neighboring class", async () => {
    const filePath = "server/serializers/task.py";
    const guard = ["class TaskSerializer:", "    class Meta:", '        fields = "__all__"', "    def validate(self, data):", '        if data.get("state") and not State.objects.filter(project_id=self.context["project_id"], pk=data["state"].id).exists():', '            raise serializers.ValidationError("State is not valid")', "        return data"].join("\n");
    const update = '    def update(self, instance, validated_data):\n        instance.updated_at = now()\n        return super().update(instance, validated_data)';
    for (const neighboring of [false, true]) {
      let reads = 0;
      const body = `${guard}\n${neighboring ? "\nclass OtherSerializer:\n" : "\n".repeat(60)}${update}\n`;
      const orchestrator = createAgentOrchestrator({ indexBackend: mockIndexBackend({ search: async () => ({ source: "zoekt", stale: false, hits: [{ fileName: filePath, lineNumber: 3, content: guard, score: 1 }], symbols: [] }) }), resolveAbsolutePath: () => undefined,
        readRemoteFile: async ({ path: remotePath }) => { reads++; return { path: remotePath, content: body }; }
      });
      const result = await orchestrator.run({ message: "The API rejects a bad state_id. Find where state is rejected and where state is written.", repoId: "github:org/repo", action: "locate", maxSteps: 1 }, {
        planTurn: async () => JSON.stringify({ tool: "search_code", args: { query: "state_id" } }),
        streamAnswer: async ({ conversation }) => {
          assert.equal(neighboring, false);
          assert.match(JSON.stringify(conversation), /return super\(\)\.update/);
          return "The same serializer rejects state and delegates the accepted update.";
        }
      });
      assert.equal(reads, 1, "Writer retention must reuse the turn's remote body cache");
      if (neighboring) assert.match(result.answer ?? "", /not the state write\/update site/);
      else {
        assert.match(result.answer ?? "", /State is not valid/);
        assert.match(result.answer ?? "", /return super\(\)\.update/);
        assert.match(result.answer ?? "", /task\.py:68-70/);
      }
    }
  });

  console.log(`\nAgentOrchestrator: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
