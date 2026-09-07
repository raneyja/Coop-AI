import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { ChatThreadStore, isDraftChatThread } from "./chatThreadStore";
import type { ChatMessage } from "./types";

function userMessage(content: string): ChatMessage {
  return { role: "user", content, timestamp: Date.now() };
}

function createMemoryContext(initial?: unknown): vscode.ExtensionContext {
  const data = new Map<string, unknown>();
  if (initial !== undefined) {
    data.set("coopAI.chatThreads.v1.test-scope", initial);
  }
  return {
    workspaceState: {
      get: (key: string) => data.get(key),
      update: (key: string, value: unknown) => {
        data.set(key, value);
        return Promise.resolve();
      }
    }
  } as vscode.ExtensionContext;
}

function createStore(initial?: unknown): ChatThreadStore {
  return new ChatThreadStore(createMemoryContext(initial), "test-scope");
}

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  await test("isDraftChatThread is true until a message or artifact exists", () => {
    assert.equal(isDraftChatThread({ messages: [] }), true);
    assert.equal(isDraftChatThread({ messages: [], artifacts: [], messageCount: 0 }), true);
    assert.equal(isDraftChatThread({ messages: [userMessage("hi")] }), false);
    assert.equal(isDraftChatThread({ messages: [], artifacts: [{}], messageCount: 0 }), false);
  });

  await test("empty composer is not listed in thread history", () => {
    const store = createStore();
    assert.equal(store.listSummaries().length, 0);
    assert.equal(store.getActiveThread().title, "New Chat");
    assert.equal(store.listAllThreads().length, 1);
  });

  await test("clicking New Chat on an empty draft reuses it instead of stacking history", () => {
    const store = createStore();
    const firstId = store.getActiveThreadId();
    store.startNewThread();
    store.startNewThread();
    assert.equal(store.getActiveThreadId(), firstId);
    assert.equal(store.listAllThreads().length, 1);
    assert.equal(store.listSummaries().length, 0);
  });

  await test("New Chat after a prompt keeps the conversation and hides the unused draft", () => {
    const store = createStore();
    store.setActiveThread([userMessage("trace this auth check")], 0, "trace this auth check");
    assert.equal(store.listSummaries().length, 1);

    const conversationId = store.getActiveThreadId();
    store.startNewThread();
    store.startNewThread();

    const summaries = store.listSummaries();
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].id, conversationId);
    assert.equal(store.getActiveThread().messageCount, 0);
    assert.equal(store.listAllThreads().length, 2);
  });

  await test("switching away from an unused New Chat discards it", () => {
    const store = createStore();
    store.setActiveThread([userMessage("how does auth work")], 0, "how does auth work");
    const conversationId = store.getActiveThreadId();
    store.startNewThread();
    assert.equal(store.listAllThreads().length, 2);

    const restored = store.switchTo(conversationId);
    assert.equal(restored?.id, conversationId);
    assert.equal(store.listAllThreads().length, 1);
    assert.equal(store.listSummaries().length, 1);
  });

  await test("load drops leftover empty threads from history", () => {
    const store = createStore({
      activeThreadId: "draft-a",
      lastActiveAt: Date.now(),
      threads: [
        {
          id: "draft-a",
          title: "New Chat",
          messages: [],
          artifacts: [],
          sessionCostUsd: 0,
          createdAt: 1,
          updatedAt: 3,
          messageCount: 0
        },
        {
          id: "draft-b",
          title: "New Chat",
          messages: [],
          artifacts: [],
          sessionCostUsd: 0,
          createdAt: 2,
          updatedAt: 2,
          messageCount: 0
        },
        {
          id: "real",
          title: "how does auth work",
          messages: [userMessage("how does auth work")],
          artifacts: [],
          sessionCostUsd: 0,
          createdAt: 1,
          updatedAt: 1,
          messageCount: 1
        }
      ]
    });

    assert.deepEqual(
      store.listSummaries().map((thread) => thread.id),
      ["real"]
    );
    assert.deepEqual(
      store.listAllThreads().map((thread) => thread.id).sort(),
      ["draft-a", "real"]
    );
  });

  await test("idle restore opens a blank composer without adding New Chat to history", () => {
    const now = Date.now();
    const store = createStore({
      activeThreadId: "real",
      lastActiveAt: now - 10 * 60_000,
      threads: [
        {
          id: "real",
          title: "how does auth work",
          messages: [userMessage("how does auth work")],
          artifacts: [],
          sessionCostUsd: 0,
          createdAt: now - 20 * 60_000,
          updatedAt: now - 10 * 60_000,
          messageCount: 1
        }
      ]
    });

    const restored = store.resolveStartupThread(60_000);
    assert.equal(restored.messageCount, 0);
    assert.equal(restored.id === "real", false);
    assert.equal(store.listSummaries().length, 1);
    assert.equal(store.listSummaries()[0].id, "real");
  });

  await test("assistant activity trail survives thread restore", () => {
    const store = createStore();
    const messages: ChatMessage[] = [
      userMessage("where is login?"),
      {
        role: "assistant",
        content: "In auth.ts",
        timestamp: Date.now(),
        activity: {
          durationMs: 12_000,
          thinkingText: "Look in the auth module.",
          tools: [{ id: "t", kind: "read", label: "Read `src/auth.ts`", status: "done" }],
          files: [{ path: "src/auth.ts", action: "read" }],
          steps: [{ id: "s", content: "Read `src/auth.ts`", status: "completed" }]
        }
      }
    ];
    store.setActiveThread(messages, 0, "where is login?");
    const id = store.getActiveThreadId();
    store.startNewThread();
    const restored = store.switchTo(id);
    assert.equal(restored?.messages[1]?.content, "In auth.ts");
    assert.equal(restored?.messages[1]?.activity?.thinkingText, "Look in the auth module.");
    assert.equal(restored?.messages[1]?.activity?.files[0]?.path, "src/auth.ts");
  });

  await test("startNewThread without inherit does not copy the prior repo", async () => {
    const store = createStore();
    store.setActiveThread([userMessage("hi")], 0, "hi", [], {
      owner: "coopai-group",
      repo: "InspectIQ",
      branch: "main",
      scope: "repo"
    });
    const priorId = store.getActiveThreadId();
    const next = store.startNewThread();
    assert.equal(next.repoContext, undefined);
    assert.equal(next.messages.length, 0);
    const prior = store.switchTo(priorId);
    assert.equal(prior?.repoContext?.repo, "InspectIQ");
    assert.equal(prior?.repoContext?.scope, "repo");
  });

  await test("startNewThread does not reuse a draft that still has Use-repo", async () => {
    const store = createStore();
    store.setActiveThread([], 0, "New Chat", [], {
      owner: "coopai-group",
      repo: "InspectIQ",
      branch: "main",
      scope: "repo"
    });
    const priorId = store.getActiveThreadId();
    const next = store.startNewThread();
    assert.notEqual(next.id, priorId);
    assert.equal(next.repoContext, undefined);
    const prior = store.getThreadById(priorId);
    assert.equal(prior?.repoContext?.repo, "InspectIQ");
  });

  await test("persisting empty context clears Use-repo on the thread", async () => {
    const store = createStore();
    store.setActiveThread([], 0, "New Chat", [], {
      owner: "coopai-group",
      repo: "InspectIQ",
      scope: "repo"
    });
    store.setActiveThread([], 0, "New Chat", [], {});
    assert.equal(store.getActiveThread().repoContext, undefined);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
