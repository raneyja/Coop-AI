import assert from "node:assert/strict";
import type { ContextFetchRequest } from "./requestBatcher";
import {
  applySemanticByteBudget,
  gateOptionsFromRequest,
  isPlainChatIntentEvent,
  mergeRepoSemanticContext,
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
}

void runAsyncTests().then(() => {
  console.log(`\nrepoSemanticRetrieval: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
});
