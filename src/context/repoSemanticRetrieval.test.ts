import assert from "node:assert/strict";
import type { ContextFetchRequest } from "./requestBatcher";
import {
  applySemanticByteBudget,
  gateOptionsFromRequest,
  isPlainChatIntentEvent,
  rankSearchPaths,
  shouldRunRepoSemanticRetrieval,
  MAX_SEMANTIC_BYTES,
  MAX_SEMANTIC_FILES
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

console.log(`\nrepoSemanticRetrieval: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
