import assert from "node:assert/strict";
import type { ContextFetchRequest } from "./requestBatcher";
import {
  applySemanticByteBudget,
  filterSemanticFilesToRepoId,
  gateOptionsFromRequest,
  isPlainChatIntentEvent,
  mergeRepoSemanticContext,
  mergeFocusSearchResults,
  rankSearchPaths,
  semanticRetrievalQueryText,
  shouldRunRepoSemanticRetrieval,
  MAX_SEMANTIC_BYTES,
  MAX_SEMANTIC_FILES,
  SEMANTIC_QUERY_MIN_LENGTH,
  SEMANTIC_QUERY_MIN_LENGTH_EDIT
} from "./repoSemanticRetrieval";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function chatRequest(queryText: string, quickAction?: string): ContextFetchRequest {
  const intent = {
    id: "test",
    intent: quickAction ? "quick_action_clicked" : "manual_chat_submit",
    timestamp: new Date(),
    costEstimate: "expensive" as const,
    context: { queryText, ...(quickAction ? { buttonClicked: quickAction } : {}) }
  };
  return {
    id: "req",
    type: "chat_context",
    params: { repoId: "acme/coop-ai", quickAction },
    intent,
    cost: "expensive",
    createdAt: new Date()
  };
}

test("shouldRunRepoSemanticRetrieval allows plain chat with long query", () => {
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "how does authentication work in this repo?",
      intentIsPlainChat: true,
      inScopeMentionCount: 0,
      enabled: true
    }),
    true
  );
});

test("shouldRunRepoSemanticRetrieval skips inventory / file-count questions", () => {
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "how many files are inside of this repo?",
      intentIsPlainChat: true,
      inScopeMentionCount: 0,
      enabled: true
    }),
    false
  );
});

test("shouldRunRepoSemanticRetrieval skips structure / monorepo questions", () => {
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "is this a monorepo?",
      intentIsPlainChat: true,
      inScopeMentionCount: 0,
      enabled: true
    }),
    false
  );
});

test("shouldRunRepoSemanticRetrieval skips package-boundary questions", () => {
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "Where are the Next.js / API package boundaries?",
      intentIsPlainChat: true,
      inScopeMentionCount: 0,
      enabled: true
    }),
    false
  );
});

test("shouldRunRepoSemanticRetrieval rejects short query", () => {
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "short query",
      intentIsPlainChat: true,
      inScopeMentionCount: 0,
      enabled: true
    }),
    false
  );
});

test("shouldRunRepoSemanticRetrieval allows edit intent with 8-char slash args", () => {
  assert.equal(SEMANTIC_QUERY_MIN_LENGTH_EDIT, 8);
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "add logs",
      codeEditIntent: true,
      intentIsPlainChat: true,
      inScopeMentionCount: 0,
      enabled: true
    }),
    true
  );
});

test("shouldRunRepoSemanticRetrieval rejects edit intent below min without selection", () => {
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "fix",
      codeEditIntent: true,
      intentIsPlainChat: true,
      inScopeMentionCount: 0,
      enabled: true
    }),
    false
  );
});

test("shouldRunRepoSemanticRetrieval allows edit intent when selection supplements short args", () => {
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "fix",
      selectionText: "function authenticateUser(token: string)",
      codeEditIntent: true,
      intentIsPlainChat: true,
      inScopeMentionCount: 0,
      enabled: true
    }),
    true
  );
});

test("shouldRunRepoSemanticRetrieval keeps 12-char min for plain chat", () => {
  assert.equal(SEMANTIC_QUERY_MIN_LENGTH, 12);
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "add logs",
      intentIsPlainChat: true,
      inScopeMentionCount: 0,
      enabled: true
    }),
    false
  );
});

test("semanticRetrievalQueryText combines slash args and selection for edit", () => {
  assert.equal(
    semanticRetrievalQueryText({
      queryText: "fix typo",
      selectionText: "const value = 1;",
      codeEditIntent: true
    }),
    "fix typo\nconst value = 1;"
  );
  assert.equal(
    semanticRetrievalQueryText({
      queryText: "how does authentication work in this repo?",
      codeEditIntent: false
    }),
    "how does authentication work in this repo?"
  );
});

test("gateOptionsFromRequest passes codeEditIntent and selectionText extras", () => {
  const request = chatRequest("fix bug");
  const gate = gateOptionsFromRequest(request, {
    inScopeMentionCount: 0,
    enabled: true,
    codeEditIntent: true,
    selectionText: "export function signIn() {}"
  });
  assert.equal(gate.codeEditIntent, true);
  assert.equal(gate.selectionText, "export function signIn() {}");
  assert.equal(
    shouldRunRepoSemanticRetrieval(gate),
    true
  );
});

test("shouldRunRepoSemanticRetrieval rejects quick actions", () => {
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "how does authentication work in this repo?",
      quickAction: "blast-radius",
      intentIsPlainChat: false,
      inScopeMentionCount: 0,
      enabled: true
    }),
    false
  );
});

test("shouldRunRepoSemanticRetrieval rejects two or more in-scope mentions", () => {
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "how does authentication work in this repo?",
      intentIsPlainChat: true,
      inScopeMentionCount: 2,
      enabled: true
    }),
    false
  );
});

test("shouldRunRepoSemanticRetrieval allows one in-scope mention", () => {
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "how does authentication work in this repo?",
      intentIsPlainChat: true,
      inScopeMentionCount: 1,
      enabled: true
    }),
    true
  );
});

test("shouldRunRepoSemanticRetrieval respects feature flag", () => {
  assert.equal(
    shouldRunRepoSemanticRetrieval({
      queryText: "how does authentication work in this repo?",
      intentIsPlainChat: true,
      inScopeMentionCount: 0,
      enabled: false
    }),
    false
  );
});

test("isPlainChatIntentEvent matches manual chat and hotkey", () => {
  assert.equal(
    isPlainChatIntentEvent({
      intent: "manual_chat_submit",
      context: {}
    }),
    true
  );
  assert.equal(
    isPlainChatIntentEvent({
      intent: "quick_action_clicked",
      context: { buttonClicked: "find-owner" }
    }),
    false
  );
});

test("gateOptionsFromRequest reads query and quick action from request", () => {
  const request = chatRequest("how does auth work here?", undefined);
  const gate = gateOptionsFromRequest(request, { inScopeMentionCount: 0, enabled: true });
  assert.equal(gate.queryText, "how does auth work here?");
  assert.equal(gate.quickAction, undefined);
  assert.equal(gate.intentIsPlainChat, true);
});

test("rankSearchPaths deduplicates and prefers higher scores", () => {
  const ranked = rankSearchPaths({
    source: "zoekt",
    stale: false,
    hits: [
      { fileName: "src/a.ts", lineNumber: 1, content: "a", score: 0.7 },
      { fileName: "src/a.ts", lineNumber: 2, content: "a2", score: 0.9 },
      { fileName: "src/b.ts", lineNumber: 1, content: "b", score: 0.8 }
    ],
    symbols: [{ symbol: "fn", kind: "function", file: "src/c.ts", line: 1, character: 0, displayName: "fn" }]
  });
  assert.deepEqual(
    ranked.map((entry) => entry.path).sort(),
    ["src/a.ts", "src/b.ts", "src/c.ts"]
  );
  assert.equal(ranked.find((entry) => entry.path === "src/a.ts")?.score, 0.9);
});

test("applySemanticByteBudget caps file count and total bytes", () => {
  const files = [
    { path: "a.ts", repoId: "acme/coop-ai", content: "x".repeat(40_000) },
    { path: "b.ts", repoId: "acme/coop-ai", content: "y".repeat(40_000) },
    { path: "c.ts", repoId: "acme/coop-ai", content: "z".repeat(10_000) },
    { path: "d.ts", repoId: "acme/coop-ai", content: "w".repeat(10_000) }
  ];
  const snippets = applySemanticByteBudget(files, MAX_SEMANTIC_BYTES, MAX_SEMANTIC_FILES);
  assert.equal(snippets.length, 3);
  const totalBytes = snippets.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0);
  assert.ok(totalBytes <= MAX_SEMANTIC_BYTES, `expected <= ${MAX_SEMANTIC_BYTES}, got ${totalBytes}`);
});

test("filterSemanticFilesToRepoId rejects documenso and Coop bleed for plane", () => {
  const filtered = filterSemanticFilesToRepoId(
    [
      {
        path: "apps/api/plane/bgtasks/notification.py",
        repoId: "github:CoopAI-Corp/plane",
        content: "ok"
      },
      {
        path: "packages/lib/types/is-document-status.ts",
        repoId: "github:CoopAI-Corp/documenso",
        content: "wrong"
      },
      { path: "src/chat/types.ts", repoId: "github:raneyja/Coop-AI", content: "wrong" }
    ],
    "github:CoopAI-Corp/plane"
  );
  assert.deepEqual(
    filtered.map((file) => file.path),
    ["apps/api/plane/bgtasks/notification.py"]
  );
});

async function asyncTest(name: string, fn: () => Promise<void>): Promise<void> {
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

test("mergeFocusSearchResults round-robins unique paths from topic searches", () => {
  const merged = mergeFocusSearchResults(
    [
      {
        source: "repo-semantic-search",
        query: "API auth",
        files: [
          {
            path: "apps/api/plane/api/middleware/api_authentication.py",
            repoId: "coop-ai/plane",
            content: "class APIKeyAuthentication:"
          }
        ]
      },
      {
        source: "repo-semantic-search",
        query: "states",
        files: [
          {
            path: "apps/api/plane/db/models/state.py",
            repoId: "coop-ai/plane",
            content: "class State:"
          }
        ]
      }
    ],
    { query: "API auth | states", rankQuery: "where does API auth live", maxFiles: 5 }
  );
  assert.ok(merged);
  assert.equal(merged!.files.length, 2);
  assert.ok(merged!.files.some((file) => file.path.includes("api_authentication")));
  assert.ok(merged!.files.some((file) => file.path.includes("state.py")));
});

test("mergeFocusSearchResults drops OpenAPI/seed/i18n when domain files exist", () => {
  const snippet = (path: string, content: string) => ({
    path,
    repoId: "coop-ai/plane",
    content
  });
  const merged = mergeFocusSearchResults(
    [
      {
        source: "repo-semantic-search",
        query: "authentication",
        files: [
          snippet("apps/api/plane/settings/openapi.py", "openapi schema"),
          snippet(
            "apps/api/plane/api/middleware/api_authentication.py",
            "class APIKeyAuthentication:"
          )
        ]
      },
      {
        source: "repo-semantic-search",
        query: "issue",
        files: [
          snippet("apps/api/plane/seeds/data/issues.json", "[]"),
          snippet("apps/api/plane/db/models/issue.py", "class Issue:")
        ]
      },
      {
        source: "repo-semantic-search",
        query: "state",
        files: [
          snippet("packages/i18n/src/locales/en/workspace.json", "{}"),
          snippet("apps/api/plane/db/models/state.py", "class State:")
        ]
      }
    ],
    { query: "authentication | issue | state", rankQuery: "authentication issue state", maxFiles: 5 }
  );
  assert.ok(merged);
  const paths = merged!.files.map((file) => file.path);
  assert.ok(paths.some((path) => path.includes("api_authentication.py")));
  assert.ok(paths.some((path) => path.endsWith("issue.py")));
  assert.ok(paths.some((path) => path.endsWith("state.py")));
  assert.ok(!paths.some((path) => /openapi|seeds\/|locales\/|i18n\//.test(path)));
});

test("mergeFocusSearchResults does not let auth files crowd out issue/state models", () => {
  const snippet = (path: string, content: string) => ({
    path,
    repoId: "coop-ai/plane",
    content
  });
  const merged = mergeFocusSearchResults(
    [
      {
        source: "repo-semantic-search",
        query: "authentication",
        files: [
          snippet(
            "apps/api/plane/api/middleware/api_authentication.py",
            "class APIKeyAuthentication:"
          ),
          snippet(
            "apps/api/plane/app/middleware/api_authentication.py",
            "class APIKeyAuthentication:"
          ),
          snippet(
            "apps/admin/components/authentication/authentication-method-card.tsx",
            "export function AuthenticationMethodCard"
          ),
          snippet(
            "apps/api/plane/tests/contract/app/test_authentication.py",
            "def test_authentication"
          )
        ]
      },
      {
        source: "repo-semantic-search",
        query: "issue",
        files: [snippet("apps/api/plane/db/models/issue.py", "class Issue:")]
      },
      {
        source: "repo-semantic-search",
        query: "state",
        files: [snippet("apps/api/plane/db/models/state.py", "class State:")]
      }
    ],
    { query: "authentication | issue | state", rankQuery: "authentication issue state", maxFiles: 5 }
  );
  assert.ok(merged);
  const paths = merged!.files.map((file) => file.path);
  assert.ok(paths.some((path) => path.includes("api_authentication.py")));
  assert.ok(paths.some((path) => path.endsWith("issue.py")), `issue missing from ${paths.join(", ")}`);
  assert.ok(paths.some((path) => path.endsWith("state.py")), `state missing from ${paths.join(", ")}`);
  assert.ok(!paths.some((path) => /\/tests?\/|\/migrations?\//.test(path)));
  assert.ok(merged!.pathHits?.some((path) => path.endsWith("issue.py")));
  assert.ok(merged!.pathHits?.some((path) => path.endsWith("state.py")));
});

test("mergeFocusSearchResults keeps issue/state pathHits when attach cap is auth-only", () => {
  const snippet = (path: string, content: string) => ({
    path,
    repoId: "coop-ai/plane",
    content
  });
  const merged = mergeFocusSearchResults(
    [
      {
        source: "repo-semantic-search",
        query: "authentication",
        files: [
          snippet(
            "apps/api/plane/api/middleware/api_authentication.py",
            "class APIKeyAuthentication:"
          )
        ],
        pathHits: [
          "apps/api/plane/api/middleware/api_authentication.py",
          "apps/api/plane/db/models/issue.py",
          "apps/api/plane/db/models/state.py"
        ]
      }
    ],
    { query: "authentication", rankQuery: "authentication issue state", maxFiles: 1 }
  );
  assert.ok(merged);
  assert.equal(merged!.files.length, 1);
  assert.ok(merged!.pathHits?.some((path) => path.endsWith("issue.py")));
  assert.ok(merged!.pathHits?.some((path) => path.endsWith("state.py")));
});

async function runAsyncTests(): Promise<void> {
  await asyncTest("mergeRepoSemanticContext attaches repoSemanticSearch to chat context", async () => {
    const semantic = {
      source: "repo-semantic-search" as const,
      query: "how does authentication work in this repository?",
      files: [{ path: "src/auth.ts", repoId: "acme/app", content: "export function signIn() {}" }]
    };
    const merged = mergeRepoSemanticContext(
      { requestId: "r1", type: "chat_context", fetchedAt: new Date(), data: { context: {} } },
      semantic
    );
    const data = merged.data as { repoSemanticSearch?: { files: Array<{ path: string }> } };
    assert.equal(data.repoSemanticSearch?.files[0]?.path, "src/auth.ts");
  });

  await asyncTest("mergeRepoSemanticContext keeps pathHits when no extra bodies", async () => {
    const semantic = {
      source: "repo-semantic-search" as const,
      query: "Explain requireAuth in this file",
      files: [] as Array<{ path: string; repoId: string; content: string }>,
      pathHits: ["src/jobs/jobsApi.ts", "src/server/sse/samlApi.ts"]
    };
    const merged = mergeRepoSemanticContext(
      { requestId: "r1", type: "chat_context", fetchedAt: new Date(), data: { context: {} } },
      semantic
    );
    const data = merged.data as { repoSemanticSearch?: { pathHits?: string[]; files: unknown[] } };
    assert.deepEqual(data.repoSemanticSearch?.pathHits, [
      "src/jobs/jobsApi.ts",
      "src/server/sse/samlApi.ts"
    ]);
    assert.equal(data.repoSemanticSearch?.files.length, 0);
  });
}

void runAsyncTests().then(() => {
  console.log(`\nrepoSemanticRetrieval: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
});
