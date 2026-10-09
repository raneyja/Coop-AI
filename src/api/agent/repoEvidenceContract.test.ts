import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type { IndexBackend } from "../../indexing/indexBackend";
import type { AgentToolContext } from "./agentToolContext";
import type { AgentSessionRequest, AgentSessionResult, AgentStreamAnswerInput } from "./agentTypes";
import type { AgentRunOptions } from "./AgentOrchestrator";
import { createAgentOrchestrator } from "./AgentOrchestrator";
import { summarizeAgentToolResultForHistory } from "../../chat/agentAnswerHistory";
import { planRawChatAskFromRules } from "../../chat/intentPlanner/frontDoor";
import { agentTurnAction, agentTurnAllowsRepoTools, shouldRunAgentToolLoop } from "../../chat/agentRouting";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}\n    ${String(error)}`); }
}

const repoId = "CoopAI-Corp/documenso";
const target = { repoId, branch: "main" };
const configPath = "apps/remix/react-router.config.ts";
const agentsBody = "# Repo rules\nNever use classes; prefer functional/declarative patterns.\nDo not use enums.\n";
const configBody = "export default {\n  appDirectory: 'app',\n  ssr: true,\n};\n";
const original = "Using only the selected CoopAI-Corp/documenso repository context, list two concrete rules from its root AGENTS.md. Then state the value of appDirectory in /apps/remix/react-router.config.ts.";

function indexBackend(): IndexBackend {
  return {
    kind: "local",
    isEnabledForRepo: async () => true,
    enableRepo: async () => ({ repoId, enabled: true, status: "ready" }),
    disableRepo: async () => undefined,
    refreshRepo: async () => ({ repoId, enabled: true, status: "ready" }),
    getRepoStatus: async () => undefined,
    listRepoStatuses: async () => [],
    search: async () => ({ source: "zoekt", stale: false, hits: [], symbols: [] }),
    dependents: async (file) => ({ file, dependents: [], source: "scip" }),
    summarize: async () => ({ enabledRepos: 1, totalDiskBytes: 0, readyRepos: 1, indexingRepos: 0 })
  };
}

async function exercise(
  query: string,
  bodies: Record<string, string>,
  overrides: Partial<AgentToolContext> = {},
  options: AgentRunOptions = {},
  requestOverrides: Partial<Pick<AgentSessionRequest, "action" | "maxSteps">> = {}
): Promise<{ result: AgentSessionResult; reads: string[]; discoveries: string[]; synthesis?: AgentStreamAnswerInput }> {
  const reads: string[] = [];
  const discoveries: string[] = [];
  let synthesis: AgentStreamAnswerInput | undefined;
  const agent = createAgentOrchestrator({
    indexBackend: indexBackend(),
    resolveAbsolutePath: () => { throw new Error("repository intelligence must never read local disk"); },
    readRemoteFile: async ({ path, repoId: readRepo, target: readTarget }) => {
      assert.equal(readRepo, repoId);
      assert.deepEqual(readTarget, target);
      reads.push(path);
      return bodies[path] === undefined ? undefined : { path, content: bodies[path] };
    },
    findFiles: async ({ query: name, repoId: findRepo, target: findTarget }) => {
      assert.equal(findRepo, repoId);
      assert.deepEqual(findTarget, target);
      discoveries.push(name);
      return Object.keys(bodies).filter(path => path.split("/").at(-1) === name);
    },
    ...overrides
  });
  const result = await agent.run({ message: query, repoId, action: "understand", maxSteps: 4, ...requestOverrides }, {
    repoTarget: target,
    planTurn: async () => '{"done":true}',
    streamAnswer: async (input) => { synthesis = input; return "Answer from attached source evidence."; },
    ...options
  });
  return { result, reads, discoveries, synthesis };
}

function assertReadDelivered(run: Awaited<ReturnType<typeof exercise>>, path: string, body: string): void {
  assert.ok(run.synthesis, "named file evidence must reach answer synthesis");
  const files = (run.result.context?.read_file?.files ?? []) as Array<{ path: string; content: string; evidenceSource?: string }>;
  const file = files.find(file => file.path === path);
  assert.ok(file, `${path} must survive in the final context`);
  assert.equal(file.evidenceSource, "remote-read");
  assert.ok(file.content.includes(body), `${path} body must be retained verbatim with real line numbers`);
  assert.match(file.content, /^1\|/);
  const delivered = writerHistory(run.synthesis).flatMap(message => {
    try {
      const payload = JSON.parse(message.content) as { files?: Array<{ path: string; content: string }> };
      return payload.files?.filter(file => file.path === path).map(file => file.content) ?? [];
    } catch { return []; }
  });
  assert.ok(delivered.some(content => content.includes(body)), `${path} verified body must reach the final serialized evidence`);
}

function writerHistory(input: AgentStreamAnswerInput): AgentStreamAnswerInput["conversation"] {
  return input.conversation.map(entry => ({ ...entry, content: entry.role === "user"
    ? summarizeAgentToolResultForHistory(entry.content) : entry.content }));
}

function assertRequirementStatus(run: Awaited<ReturnType<typeof exercise>>, path: string, status: string, candidates?: string[]): void {
  assert.ok(run.synthesis, "partial evidence must still reach synthesis");
  const payloads: unknown[] = [];
  for (const message of writerHistory(run.synthesis)) {
    try { payloads.push(JSON.parse(message.content)); } catch { /* prose is not a requirements ledger */ }
  }
  const matches: Record<string, unknown>[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if ((record.requestedPath === path || record.path === path) && record.status === status) matches.push(record);
    Object.values(record).forEach(walk);
  };
  payloads.forEach(walk);
  assert.ok(matches.length, `${path} needs its own ${status} status, not a generic hunt miss`);
  if (candidates) assert.ok(matches.some(record => Array.isArray(record.candidates) &&
    JSON.stringify([...record.candidates].sort()) === JSON.stringify([...candidates].sort())));
}

async function run(): Promise<void> {
  await test("exact live dotfile comparison treats ignore patterns as content rather than exclusions", async () => {
    const query = "Use no integrations. Read /.gitignore and /.dockerignore from the selected repository. " +
      "List one ignore pattern shared by both and one pattern present only in .gitignore.";
    const result = await exercise(query, { ".gitignore": "node_modules/\ncoverage/", ".dockerignore": "node_modules/\n.git/" });
    assert.deepEqual([...new Set(result.reads)].sort(), [".dockerignore", ".gitignore"]);
    assertReadDelivered(result, ".gitignore", "node_modules/");
    assertReadDelivered(result, ".gitignore", "coverage/");
    assertReadDelivered(result, ".dockerignore", "node_modules/");
    assertRequirementStatus(result, ".gitignore", "read");
    assertRequirementStatus(result, ".dockerignore", "read");
    assert.equal(result.result.context?.requestedFiles?.length, 2, "repeated content references do not create duplicate file requirements");
  });

  await test("a style restriction inside a file still permits reading the referenced implementation", async () => {
    const result = await exercise("Do not use classes in /src/alpha.ts; explain its functional implementation.", {
      "src/alpha.ts": "export function alpha() { return 17; }"
    });
    assert.deepEqual(result.reads, ["src/alpha.ts"]);
    assertReadDelivered(result, "src/alpha.ts", "export function alpha() { return 17; }");
  });

  await test("root files named after exclusion commands reach the actual writer", async () => {
    const files = {
      "ignore.ts": "export const ignore = 17;", "omit.ts": "export const omit = 18;",
      "without.md": "This file describes optional configuration.", "beta.ts": "export const beta = 19;"
    };
    const result = await exercise("Read ignore.ts, omit.ts, without.md, and beta.ts. Compare their contents.", files);
    assert.deepEqual([...new Set(result.reads)].sort(), Object.keys(files).sort());
    for (const [path, body] of Object.entries(files)) {
      assertReadDelivered(result, path, body);
      assertRequirementStatus(result, path, "read");
    }
  });

  for (const exclusion of ["do not read", "don't quote or use", "exclude", "except", "without reading"]) {
    await test(`file exclusion vetoes requested reads and malicious planner suggestion: ${exclusion}`, async () => {
      const query = `Read /src/alpha.ts; ${exclusion} /src/private.ts. Explain the permitted file and what other files rely on it.`;
      let plannerInvoked = false;
      const result = await exercise(query, {
        "src/alpha.ts": "export const alpha = 17;", "src/private.ts": "export const excludedPrivate = 9001;"
      }, {}, {
        planTurn: async ({ round }) => {
          plannerInvoked = true;
          return round === 0 ? '{"tool":"read_file","args":{"path":"src/private.ts"}}' : '{"done":true}';
        }
      });
      assert.equal(plannerInvoked, true, "the adversarial planner must actually run to prove the tool boundary");
      assert.deepEqual(result.reads, ["src/alpha.ts"]);
      assertReadDelivered(result, "src/alpha.ts", "export const alpha = 17;");
      assert.doesNotMatch(JSON.stringify(result.synthesis), /excludedPrivate/);
      assert.ok(!result.result.context?.requestedFiles?.some(file => file.requestedPath === "src/private.ts"));
    });
  }

  await test("excluded captured source never reaches planner or final writer evidence", async () => {
    let plannerLeaked = false;
    let plannerInvoked = false;
    const query = "Read /src/alpha.ts but do not use /src/private.ts. Explain what other files rely on it.";
    const result = await exercise(query, { "src/alpha.ts": "export const alpha = 17;" }, {}, {
      capturedAttachment: { ...target, files: [
        { path: "src/private.ts", content: "export const excludedCaptured = 9001;" }
      ] },
      planTurn: async (input) => { plannerInvoked = true; plannerLeaked ||= JSON.stringify(input).includes("excludedCaptured"); return '{"done":true}'; }
    });
    assert.equal(plannerInvoked, true);
    assert.deepEqual(result.reads, ["src/alpha.ts"]);
    assert.equal(plannerLeaked, false);
    assertReadDelivered(result, "src/alpha.ts", "export const alpha = 17;");
    assert.doesNotMatch(JSON.stringify(result.synthesis), /excludedCaptured/);
  });

  await test("a bare basename exclusion blocks that file anywhere in the selected repo", async () => {
    let plannerInvoked = false;
    const result = await exercise("Read /src/alpha.ts; do not read private.ts. Explain what other files rely on it.", {
      "src/alpha.ts": "export const alpha = 17;", "apps/server/private.ts": "export const excludedBasename = 9001;"
    }, {}, {
      planTurn: async ({ round }) => {
        plannerInvoked = true;
        return round === 0 ? '{"tool":"read_file","args":{"path":"apps/server/private.ts"}}' : '{"done":true}';
      }
    });
    assert.equal(plannerInvoked, true);
    assert.deepEqual(result.reads, ["src/alpha.ts"]);
    assertReadDelivered(result, "src/alpha.ts", "export const alpha = 17;");
    assert.doesNotMatch(JSON.stringify(result.synthesis), /excludedBasename/);
  });

  await test("basename resolution filters an excluded exact candidate before deciding ambiguity", async () => {
    const result = await exercise("Read config.ts but do not read /apps/web/config.ts.", {
      "apps/api/config.ts": "export const permittedConfig = 17;",
      "apps/web/config.ts": "export const excludedConfig = 9001;"
    });
    assert.deepEqual(result.reads, ["apps/api/config.ts"]);
    assertReadDelivered(result, "apps/api/config.ts", "export const permittedConfig = 17;");
    assert.doesNotMatch(JSON.stringify(result.synthesis), /excludedConfig/);
  });

  for (const rootRef of ["/config.ts", "./config.ts"]) {
    await test(`positive basename resolves a nested file when exact root occurrence ${rootRef} is excluded`, async () => {
      const result = await exercise(`Read config.ts, but do not read ${rootRef}.`, {
        "config.ts": "export const ExcludedRootConfig = 9001;",
        "apps/api/config.ts": "export const permittedConfig = 17;"
      });
      assert.deepEqual(result.reads, ["apps/api/config.ts"]);
      assertReadDelivered(result, "apps/api/config.ts", "export const permittedConfig = 17;");
      assert.doesNotMatch(JSON.stringify(result.synthesis), /ExcludedRootConfig/);
    });
  }

  for (const searchSource of ["index", "code host"] as const) {
    await test(`excluded ${searchSource} search snippets and symbols never reach planning or final evidence`, async () => {
      let searchCalls = 0;
      let plannerInvoked = false;
      let leaked = false;
      const backend = indexBackend();
      const allowedPath = "src/consumer.ts";
      const privatePath = "src/private.ts";
      const query = "Read /src/alpha.ts and explain alphaPolicy and what other files rely on it. Do not read /src/private.ts.";
      backend.isEnabledForRepo = async () => searchSource === "index";
      backend.search = async () => {
        searchCalls++;
        return { source: "zoekt", stale: false, hits: [
          { fileName: privatePath, lineNumber: 1, content: "ExcludedSearchSnippet alphaPolicy()", score: 1 },
          { fileName: allowedPath, lineNumber: 1, content: "export const used = alphaPolicy();", score: 0.8 }
        ], symbols: [
          { symbol: "ExcludedSearchSymbol", displayName: "ExcludedSearchSymbol", file: privatePath, line: 1, character: 0, kind: "function" }
        ] };
      };
      const result = await exercise(query, {
        "src/alpha.ts": "export function alphaPolicy() { return 17; }",
        [allowedPath]: "export const used = alphaPolicy();",
        [privatePath]: "export const ExcludedSearchBody = alphaPolicy();"
      }, {
        indexBackend: backend, findFiles: async () => [],
        searchCodeHost: searchSource === "code host" ? async () => {
          searchCalls++;
          return [{ path: privatePath, snippet: "ExcludedSearchSnippet alphaPolicy()" },
            { path: allowedPath, snippet: "export const used = alphaPolicy();" }];
        } : undefined
      }, {
        planTurn: async (input) => {
          plannerInvoked = true;
          leaked ||= /ExcludedSearch(?:Snippet|Symbol|Body)/.test(JSON.stringify(input));
          return input.round === 0 ? '{"tool":"search_code","args":{"query":"alphaPolicy"}}' : '{"done":true}';
        }
      });
      assert.equal(plannerInvoked, true);
      assert.ok(searchCalls > 0, `${searchSource} boundary must actually execute`);
      assert.equal(leaked, false);
      assert.equal(result.reads.includes(privatePath), false);
      assert.doesNotMatch(JSON.stringify(result.result.context), /ExcludedSearch(?:Snippet|Symbol|Body)/);
      assert.doesNotMatch(JSON.stringify(result.synthesis), /ExcludedSearch(?:Snippet|Symbol|Body)/);
      const hits = result.result.context?.search_code?.hits as Array<{ fileName: string }> | undefined;
      assert.ok(hits?.some(hit => hit.fileName === allowedPath), "allowed search hits remain useful");
      assertReadDelivered(result, "src/alpha.ts", "export function alphaPolicy() { return 17; }");
    });
  }

  await test("excluded blame tools never fetch history while allowed blame remains available", async () => {
    const blamePaths: string[] = [];
    let plannerInvoked = false;
    const query = "Read /src/alpha.ts and explain who created this file and what other files rely on it. Do not use /src/private.ts.";
    const result = await exercise(query, { "src/alpha.ts": "export const alpha = 17;" }, {
      getBlame: async ({ path }) => {
        blamePaths.push(path);
        return { path, branch: "main", lines: [{ lineNumber: 1, commitSha: "verified-commit", author: "AllowedAuthor", date: "2026-10-08" }] };
      }
    }, {
      planTurn: async ({ round }) => {
        plannerInvoked = true;
        if (round === 0) return '{"tool":"git_blame","args":{"path":"src/private.ts"}}';
        if (round === 1) return '{"tool":"git_blame","args":{"path":"src/alpha.ts"}}';
        return '{"done":true}';
      }
    });
    assert.equal(plannerInvoked, true);
    assert.deepEqual(blamePaths, ["src/alpha.ts"]);
    assert.match(JSON.stringify(result.result.context?.git_blame), /AllowedAuthor/);
    assertReadDelivered(result, "src/alpha.ts", "export const alpha = 17;");
  });

  for (const query of ["Don't use beta.ts, describe alpha.ts.", "Don't use beta.ts and state the export in alpha.ts."]) {
    await test(`positive description clause remains readable after a file exclusion: ${query}`, async () => {
      const result = await exercise(query, { "alpha.ts": "export const permittedAlpha = 17;", "beta.ts": "export const ExcludedBeta = 9001;" });
      assert.deepEqual(result.reads, ["alpha.ts"]);
      assertReadDelivered(result, "alpha.ts", "export const permittedAlpha = 17;");
      assert.doesNotMatch(JSON.stringify(result.synthesis), /ExcludedBeta/);
    });
  }

  for (const providedInstructions of [undefined, "ExcludedAgentsGuidance: never use enums"]) {
    await test(`Session omits excluded automatic AGENTS guidance (${providedInstructions ? "prebuilt" : "fallback"})`, async () => {
      const require = createRequire(__filename);
      require("../../../scripts/vscode-test-stub.cjs");
      const { CoopChatSession } = require("../../chat/CoopChatSession");
      let instructionsBuilt = 0;
      let calls = 0;
      const turn = { id: "exclusion-turn", threadId: "exclusion-thread", startedAt: Date.now(),
        context: { owner: "CoopAI-Corp", repo: "documenso", branch: "main" } };
      const session = Object.assign(Object.create(CoopChatSession.prototype), {
        currentContext: turn.context, preferences: { maxTokens: 1000 },
        buildProjectInstructionsBlock: async () => { instructionsBuilt++; return "ExcludedAgentsGuidance: never use enums"; },
        options: { api: { streamChat: async (request: unknown) => {
          calls++;
          assert.doesNotMatch(JSON.stringify(request), /ExcludedAgentsGuidance/);
          return { message: { content: "Alpha verified" }, finishReason: "stop" };
        } } }
      });
      const answer = await session.streamAgentAnswer({
        message: "Read /src/alpha.ts; do not use AGENTS.md.", repoId, action: "understand", conversation: [],
        projectInstructions: providedInstructions
      }, { model: "fixture", provider: "openai" }, "chat", () => {}, undefined, turn.threadId, turn);
      assert.equal(answer, "Alpha verified");
      assert.equal(calls, 1);
      assert.equal(instructionsBuilt, 0, "excluded root instructions must not even be loaded automatically");
    });
  }

  const realisticScenarios: Array<{ name: string; prompt: string; files: Record<string, string> }> = [
    {
      name: "onboarding README plus package commands",
      prompt: "Using only this repository, read /README.md and /package.json. Explain the documented setup and list the actual npm scripts.",
      files: { "README.md": "# Setup\nRun npm ci then npm run dev.", "package.json": '{"scripts":{"dev":"vite","test":"vitest"}}' }
    },
    {
      name: "quoted relative TypeScript build configuration",
      prompt: "Compare `./tsconfig.json` with `./tsconfig.build.json`; state the compiler target and which files each includes.",
      files: { "tsconfig.json": '{"compilerOptions":{"target":"ES2022"},"include":["src"]}',
        "tsconfig.build.json": '{"extends":"./tsconfig.json","exclude":["src/**/*.test.ts"]}' }
    },
    {
      name: "GitHub workflow and package validation commands",
      prompt: "Read /.github/workflows/ci.yml and /package.json. Explain which validation commands CI executes.",
      files: { ".github/workflows/ci.yml": "steps:\n  - run: npm run lint\n  - run: npm test",
        "package.json": '{"scripts":{"lint":"tsc --noEmit","test":"vitest run"}}' }
    },
    {
      name: "SQL schema and named migration comparison",
      prompt: "Read /db/schema.sql and /db/migrations/002_add_account.sql; describe the account column introduced by the migration.",
      files: { "db/schema.sql": "CREATE TABLE account (id INTEGER PRIMARY KEY);",
        "db/migrations/002_add_account.sql": "ALTER TABLE account ADD COLUMN email TEXT;" }
    },
    {
      name: "Python model and serializer field mapping",
      prompt: "Explain /apps/api/models/account.py and /apps/api/serializers/account.py, including which model fields the serializer exposes.",
      files: { "apps/api/models/account.py": "class Account:\n    email = TextField()",
        "apps/api/serializers/account.py": "class AccountSerializer:\n    fields = ['email']" }
    },
    {
      name: "React component and stylesheet relationship",
      prompt: "Read /src/components/Badge.tsx and /src/components/Badge.css. Explain the rendered label and associated color.",
      files: { "src/components/Badge.tsx": 'export function Badge() { return <span className="badge">Ready</span>; }',
        "src/components/Badge.css": ".badge { color: green; }" }
    },
    {
      name: "Rust implementation and Cargo configuration",
      prompt: "Explain /src/lib.rs and list the dependencies declared in /Cargo.toml.",
      files: { "src/lib.rs": "pub fn enabled() -> bool { true }",
        "Cargo.toml": '[package]\nname = "fixture"\n[dependencies]\nserde = "1"' }
    },
    {
      name: "Go handler and corresponding test behavior",
      prompt: "Read /internal/health/handler.go and /internal/health/handler_test.go; compare the status handler with its test expectation.",
      files: { "internal/health/handler.go": "func Health() string { return \"ready\" }",
        "internal/health/handler_test.go": 'func TestHealth(t *testing.T) { if Health() != "ready" { t.Fatal("unexpected status") } }' }
    },
    {
      name: "dotted JavaScript configuration and route source",
      prompt: "State the output mode in /next.config.mjs, then explain the response returned by /app/api/health/route.ts.",
      files: { "next.config.mjs": 'export default { output: "standalone" };',
        "app/api/health/route.ts": 'export function GET() { return Response.json({ status: "ready" }); }' }
    },
    {
      name: "repeated explicit file reference without duplicate reads",
      prompt: "Explain /src/auth.ts, compare it with /src/session.ts, and quote the export from /src/auth.ts again.",
      files: { "src/auth.ts": "export const authPolicy = 'strict';", "src/session.ts": "export const sessionPolicy = 'ephemeral';" }
    },
    {
      name: "controlled extensionless build files and root ignore dotfile",
      prompt: "Read /Dockerfile, /Makefile, and /.gitignore. Explain the container start command, make target, and ignored output folder.",
      files: { "Dockerfile": 'FROM node:22\nCMD ["npm", "start"]', "Makefile": "build:\n\tnpm run build", ".gitignore": "dist/" }
    }
  ];
  for (const scenario of realisticScenarios) {
    await test(`realistic scenario: ${scenario.name}`, async () => {
      const { plan } = planRawChatAskFromRules(scenario.prompt, { useRepo: repoId, connectedTools: [] });
      const routing = { query: scenario.prompt, hasQuickAction: false, intentPlan: plan };
      assert.equal(shouldRunAgentToolLoop(routing), true, "actual send routing must reach the repository reader");
      assert.equal(agentTurnAllowsRepoTools(routing), true);
      const action = agentTurnAction(routing);
      const result = await exercise(scenario.prompt, scenario.files, {}, {}, { action });
      for (const [path, body] of Object.entries(scenario.files)) {
        for (const line of body.split("\n")) assertReadDelivered(result, path, line);
        assertRequirementStatus(result, path, "read");
      }
      assert.deepEqual([...new Set(result.reads)].sort(), Object.keys(scenario.files).sort());
      assert.equal(result.reads.length, Object.keys(scenario.files).length, "repeated requested paths are fetched only once");
    });
  }
  for (const query of [original, original.replace("appDirectory", "ssr")]) {
    await test(`original compound selected-repo question reaches synthesis: ${query}`, async () => {
      const result = await exercise(query, { "AGENTS.md": agentsBody, [configPath]: configBody });
      assertReadDelivered(result, "AGENTS.md", "Never use classes; prefer functional/declarative patterns.");
      assertReadDelivered(result, configPath, "appDirectory: 'app'");
      assert.equal(result.discoveries.includes("AGENTS.md"), false, "root AGENTS.md must be resolved directly");
      assert.deepEqual([...new Set(result.reads)].sort(), ["AGENTS.md", configPath].sort());
    });
  }

  for (const paths of [["src/alpha.ts", "src/beta.ts"], ["src/beta.ts", "src/alpha.ts"]]) {
    await test(`premature done cannot skip an ordinary requested file: ${paths.join(", ")}`, async () => {
      const result = await exercise(`Read /${paths[0]} and /${paths[1]} and explain both.`, {
        "src/alpha.ts": "export const alpha = 17;",
        "src/beta.ts": "export const beta = 29;"
      });
      assertReadDelivered(result, "src/alpha.ts", "export const alpha = 17;");
      assertReadDelivered(result, "src/beta.ts", "export const beta = 29;");
      assert.deepEqual([...new Set(result.reads)].sort(), ["src/alpha.ts", "src/beta.ts"]);
    });
  }

  await test("config first still reads root instructions without automatic instruction loading", async () => {
    const result = await exercise(`State appDirectory in /${configPath}, then list two concrete rules from root AGENTS.md.`, {
      "AGENTS.md": agentsBody, [configPath]: configBody
    }, {}, { projectInstructions: undefined });
    assertReadDelivered(result, configPath, "appDirectory: 'app'");
    assertReadDelivered(result, "AGENTS.md", "Do not use enums.");
  });

  await test("specialized API-rejection synthesis retains independently requested repository rules", async () => {
    const handlerPath = "packages/lib/server-only/field/sign-field-with-token.ts";
    const guard = "if (envelope.status !== DocumentStatus.PENDING) {\n" +
      "  throw new AppError(AppErrorCode.INVALID_REQUEST, { message: `Document ${envelope.id} must be pending for signing` });\n}";
    const query = "Using only the selected repository context, list two concrete rules from root AGENTS.md. " +
      `Then read /${handlerPath} and explain which status check rejects a document that must be pending for signing.`;
    const result = await exercise(query, { "AGENTS.md": agentsBody, [handlerPath]: guard });
    assertReadDelivered(result, "AGENTS.md", "Do not use enums.");
    assertReadDelivered(result, handlerPath, "envelope.status !== DocumentStatus.PENDING");
    assertRequirementStatus(result, "AGENTS.md", "read");
    assertRequirementStatus(result, handlerPath, "read");
  });

  await test("one explicit file plus an unavailable semantic rejection hunt still delivers supported rules", async () => {
    const query = "Using only the selected repository context, read root AGENTS.md and list two concrete rules. " +
      "A signer gets an error that the document must be pending for signing. " +
      "Where does the server reject this request, and what status check enforces it?";
    const result = await exercise(query, { "AGENTS.md": agentsBody }, {
      searchCodeHost: async () => []
    }, {}, { action: "locate", maxSteps: 1 });
    assertReadDelivered(result, "AGENTS.md", "Never use classes; prefer functional/declarative patterns.");
    assertReadDelivered(result, "AGENTS.md", "Do not use enums.");
    assertRequirementStatus(result, "AGENTS.md", "read");
    const history = writerHistory(result.synthesis!).map(message => message.content).join("\n");
    assert.match(history, /API-rejection part is unverified/i,
      "the final writer must receive an honest status for the unsupported semantic part");
    assert.match(history, /do not invent a rejection, guard/i);
    assert.equal(result.result.answer, "Answer from attached source evidence.",
      "a specialized canned miss cannot replace synthesis of the supported named-file part");
  });

  await test("deterministic fallback also retains every explicitly requested file for its caller", async () => {
    const result = await exercise("Read /src/alpha.ts and /src/beta.ts; explain both.", {
      "src/alpha.ts": "export const alpha = 17;", "src/beta.ts": "export const beta = 29;"
    }, {}, { planTurn: undefined });
    const files = result.result.context?.read_file?.files as Array<{ path: string; content: string }> | undefined;
    assert.equal(files?.find(file => file.path === "src/alpha.ts")?.content, "1|export const alpha = 17;");
    assert.equal(files?.find(file => file.path === "src/beta.ts")?.content, "1|export const beta = 29;");
  });

  await test("an ambiguous basename records candidates instead of opening an arbitrary file", async () => {
    const candidates = ["apps/web/config.ts", "apps/api/config.ts"];
    const result = await exercise("Read config.ts and explain its settings.", {
      [candidates[0]]: "export const webOnly = true;",
      [candidates[1]]: "export const apiOnly = true;"
    });
    assert.deepEqual(result.reads, [], "ambiguous basename must not become arbitrary verified evidence");
    assertRequirementStatus(result, "config.ts", "ambiguous", candidates);
    assert.doesNotMatch(JSON.stringify(result.synthesis), /webOnly|apiOnly/);
  });

  await test("a unique basename resolves to its verified remote path", async () => {
    const result = await exercise("Read config.ts and explain its settings.", {
      "apps/api/config.ts": "export const uniqueSetting = 41;"
    });
    assertReadDelivered(result, "apps/api/config.ts", "export const uniqueSetting = 41;");
    assert.deepEqual(result.reads, ["apps/api/config.ts"]);
  });

  await test("an explicit root path is read directly despite ambiguous basename matches", async () => {
    const result = await exercise("Read /config.ts and explain its settings.", {
      "config.ts": "export const rootSetting = 41;",
      "apps/api/config.ts": "export const nestedSetting = 9001;"
    });
    assertReadDelivered(result, "config.ts", "export const rootSetting = 41;");
    assert.deepEqual(result.discoveries, []);
    assert.deepEqual(result.reads, ["config.ts"]);
    assert.doesNotMatch(JSON.stringify(result.synthesis), /nestedSetting/);
  });

  await test("case-distinct explicit paths remain separate evidence requirements", async () => {
    const result = await exercise("Read /src/Config.ts and /src/config.ts; explain both.", {
      "src/Config.ts": "export const upperCase = 11;",
      "src/config.ts": "export const lowerCase = 22;"
    });
    assertReadDelivered(result, "src/Config.ts", "export const upperCase = 11;");
    assertReadDelivered(result, "src/config.ts", "export const lowerCase = 22;");
    assert.deepEqual([...new Set(result.reads)].sort(), ["src/Config.ts", "src/config.ts"]);
  });

  await test("case-distinct basename lookup cannot silently choose the other file", async () => {
    const result = await exercise("Read Config.ts and explain its settings.", {
      "apps/api/Config.ts": "export const requestedCase = 11;",
      "apps/api/config.ts": "export const wrongCase = 22;"
    }, { findFiles: async () => ["apps/api/config.ts", "apps/api/Config.ts"] });
    assertReadDelivered(result, "apps/api/Config.ts", "export const requestedCase = 11;");
    assert.deepEqual(result.reads, ["apps/api/Config.ts"]);
    assert.doesNotMatch(JSON.stringify(result.synthesis), /wrongCase/);
  });

  for (const mismatch of [
    { path: "src/unrequested.ts" },
    { repoId: "other/repository" },
    { branch: "other" }
  ]) {
    await test(`returned source target mismatch is rejected: ${JSON.stringify(mismatch)}`, async () => {
      const result = await exercise("Read /src/alpha.ts and explain it.", {}, {
        readRemoteFile: async () => ({ path: "src/alpha.ts", content: "export const wrongTarget = 9001;", ...mismatch })
      });
      assertRequirementStatus(result, "src/alpha.ts", "unavailable");
      assert.doesNotMatch(JSON.stringify(result.synthesis), /wrongTarget/);
      const files = result.result.context?.read_file?.files as unknown[] | undefined;
      assert.equal(files?.length ?? 0, 0);
    });
  }

  await test("final history preserves all seven required bodies and terminal outcomes", async () => {
    const bodies = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
      `src/part${index}.ts`, `export const part${index} = '${"verified-body-".repeat(100)}${index}';`
    ]));
    const paths = Object.keys(bodies);
    const result = await exercise(`Read ${paths.map(path => `/${path}`).join(", ")} and /src/missing.ts; compare all files.`, bodies);
    for (const path of paths) assertReadDelivered(result, path, bodies[path]);
    assertRequirementStatus(result, "src/missing.ts", "unavailable");
    const finalPayload = JSON.parse(summarizeAgentToolResultForHistory(JSON.stringify({
      ...result.result.context?.read_file, requestedFiles: result.result.context?.requestedFiles
    })));
    for (const path of paths) {
      assert.ok(finalPayload.files?.some((file: { path: string; content: string }) => file.path === path &&
        file.content.includes(bodies[path])), `${path} must survive the aggregate tool-result summarizer`);
    }
    assert.equal(finalPayload.requestedFiles?.length, 8, "all terminal requirements survive writer history compaction");
  });

  for (const modelRequestsVendor of [false, true]) {
    await test(`public run enforces repo-only scope against injected vendor ${modelRequestsVendor ? "tool call" : "backfill"}`, async () => {
      const calls: string[] = [];
      const result = await exercise(original, { "AGENTS.md": agentsBody, [configPath]: configBody }, {}, {
        allowedIntegrations: ["slack", "jira"], fillIntegrations: ["slack", "jira"],
        planTurn: async ({ round }) => modelRequestsVendor && round === 0
          ? '{"tool":"search_slack","args":{"query":"repo rules"}}' : '{"done":true}',
        searchIntegration: async ({ provider }) => {
          calls.push(provider);
          return { messages: [{ text: "external source must never be searched" }] };
        }
      });
      assert.deepEqual(calls, [], "scope must veto injected allowed tools and fill tools within the public orchestrator");
      assertReadDelivered(result, "AGENTS.md", "Do not use enums.");
      assertReadDelivered(result, configPath, "appDirectory: 'app'");
    });
  }

  await test("missing second file preserves first evidence and supplies an honest per-file unavailable status", async () => {
    const result = await exercise("Read /src/alpha.ts and /src/missing.ts; explain both.", {
      "src/alpha.ts": "export const alpha = 17;"
    });
    assertReadDelivered(result, "src/alpha.ts", "export const alpha = 17;");
    assert.ok(result.reads.includes("src/missing.ts"), "must attempt the explicitly requested second path");
    assertRequirementStatus(result, "src/missing.ts", "unavailable");
    assert.doesNotMatch(JSON.stringify(result.synthesis), /file (?:does not exist|is absent)|confirmed absent/i);
  });

  await test("denied second read is unavailable and cannot erase the successful first source", async () => {
    const reads: string[] = [];
    const result = await exercise("Read /src/alpha.ts and /src/private.ts; explain both.", {}, {
      readRemoteFile: async ({ path }) => {
        reads.push(path);
        if (path === "src/private.ts") throw new Error("403 forbidden");
        return { path, content: "export const alpha = 17;" };
      }
    });
    assert.ok(reads.includes("src/private.ts"));
    assertReadDelivered(result, "src/alpha.ts", "export const alpha = 17;");
    assertRequirementStatus(result, "src/private.ts", "unavailable");
  });

  await test("an unavailable first file cannot prevent reading the supported second part", async () => {
    const result = await exercise("Read /src/missing.ts and /src/beta.ts; explain both.", {
      "src/beta.ts": "export const beta = 29;"
    });
    assertRequirementStatus(result, "src/missing.ts", "unavailable");
    assertReadDelivered(result, "src/beta.ts", "export const beta = 29;");
  });

  await test("wrong-branch turn attachment cannot satisfy either requested source", async () => {
    const result = await exercise("Read /src/alpha.ts and /src/beta.ts; explain both.", {
      "src/alpha.ts": "export const alpha = 17;", "src/beta.ts": "export const beta = 29;"
    }, {}, {
      capturedAttachment: { repoId, branch: "other", files: [
        { path: "src/alpha.ts", content: "export const wrongBranch = 9001;" }
      ] }
    });
    assertReadDelivered(result, "src/alpha.ts", "export const alpha = 17;");
    assertReadDelivered(result, "src/beta.ts", "export const beta = 29;");
    assert.doesNotMatch(JSON.stringify(result.synthesis), /wrongBranch/);
  });

  await test("a captured selected range cannot satisfy an explicitly requested full file", async () => {
    const body = "export const firstSetting = 17;\nexport const lateSetting = 29;";
    const result = await exercise("Read /src/config.ts and explain all its settings.", { "src/config.ts": body }, {}, {
      capturedAttachment: { ...target, files: [
        { path: "src/config.ts", content: "export const firstSetting = 17;", lineRange: [1, 1] }
      ] }
    });
    assert.deepEqual(result.reads, ["src/config.ts"], "partial attachment requires a fresh full remote read");
    assertReadDelivered(result, "src/config.ts", "export const lateSetting = 29;");
    const requested = result.result.context?.requestedFiles?.find(file => file.requestedPath === "src/config.ts");
    assert.equal(requested?.status, "read");
    assert.equal(requested?.reason, undefined, "a complete verified remote read satisfies the full-file requirement");
  });

  await test("truncated remote bodies remain explicitly partial in outcomes and writer history", async () => {
    const result = await exercise("Read /src/config.ts and explain all its settings.", {}, {
      readRemoteFile: async () => ({ path: "src/config.ts", content: "export const firstSetting = 17;", truncated: true })
    });
    assertReadDelivered(result, "src/config.ts", "export const firstSetting = 17;");
    const requested = result.result.context?.requestedFiles?.find(file => file.requestedPath === "src/config.ts");
    assert.match(requested?.reason ?? "", /partial.*unverified/i);
    const compacted = writerHistory(result.synthesis!);
    const payloads = compacted.flatMap(message => {
      try { return [JSON.parse(message.content) as { files?: Array<{ path: string; truncated?: boolean }>; requestedFiles?: Array<{ requestedPath: string; reason?: string }> }]; }
      catch { return []; }
    });
    assert.ok(payloads.some(payload => payload.files?.some(file => file.path === "src/config.ts" && file.truncated === true)),
      "writer retains the source truncation metadata");
    assert.ok(payloads.some(payload => payload.requestedFiles?.some(file => file.requestedPath === "src/config.ts" && /partial.*unverified/i.test(file.reason ?? ""))),
      "writer retains the per-file partial-evidence warning");
  });

  await test("an exhausted soft gather budget supplies unavailable statuses and still synthesizes", async () => {
    const result = await exercise("Read /src/alpha.ts and /src/beta.ts; explain both.", {
      "src/alpha.ts": "export const alpha = 17;", "src/beta.ts": "export const beta = 29;"
    }, {}, { startedAt: Date.now() - 30_000 });
    assert.deepEqual(result.reads, [], "exhausted gather must not start additional remote requests");
    assertRequirementStatus(result, "src/alpha.ts", "unavailable");
    assertRequirementStatus(result, "src/beta.ts", "unavailable");
    assert.doesNotMatch(JSON.stringify(result.synthesis), /file (?:does not exist|is absent)|confirmed absent/i);
  });

  await test("user Stop during the first read prevents second fetch and synthesis", async () => {
    const controller = new AbortController();
    const reads: string[] = [];
    const result = await exercise("Read /src/alpha.ts and /src/beta.ts; explain both.", {}, {
      readRemoteFile: async ({ path }) => {
        reads.push(path);
        controller.abort();
        return { path, content: "export const alpha = 17;" };
      }
    }, { signal: controller.signal });
    assert.deepEqual(reads, ["src/alpha.ts"]);
    assert.equal(result.synthesis, undefined);
    assert.equal(result.result.answer, undefined);
  });

  await test("user Stop before gather prevents source reads and synthesis", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await exercise(original, { "AGENTS.md": agentsBody, [configPath]: configBody }, {}, { signal: controller.signal });
    assert.deepEqual(result.reads, []);
    assert.deepEqual(result.result.steps, []);
    assert.equal(result.synthesis, undefined);
    assert.equal(result.result.answer, undefined);
  });

  console.log(`\nrepoEvidenceContract: ${passed}/${passed + failed} tests passed`);
  if (failed) process.exitCode = 1;
}
void run();
