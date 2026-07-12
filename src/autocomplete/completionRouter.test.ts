import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import { resetMockConfiguration, setMockConfiguration } from "./test/vscodeMockSetup";
import { AutocompletePerformanceMonitor } from "./performance";
import {
  CompletionRouter,
  buildFimSegments,
  synthesizeMessageFromSegments
} from "./completionRouter";
import type { AutocompleteSettings, ExtractedCodeContext } from "./types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    resetMockConfiguration();
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

const sampleContext: ExtractedCodeContext = {
  languageId: "typescript",
  filePath: "/workspace/src/app.ts",
  currentLinePrefix: "const value = ",
  currentLineSuffix: "1;",
  suffixWindow: "1;\nnext();",
  previousLines: "import fs from 'fs';",
  importsBlock: "import fs from 'fs';",
  parentSignature: "",
  indent: "  ",
  cursorOffset: 10,
  contextHash: "abc",
  inComment: false,
  inString: false,
  afterDot: false,
  afterOpenParen: false,
  riskySyntax: false
};

const autocompleteSettings: AutocompleteSettings = {
  enabled: true,
  trigger: "auto",
  maxSuggestionLength: 200,
  debounceMs: 300,
  model: "haiku",
  customModel: "",
  showMultipleSuggestions: false,
  requestTimeoutMs: 5_000,
  useFim: true,
  useGraphContext: false
};

async function asyncTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    resetMockConfiguration();
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("buildFimSegments returns prefix and suffix when useFim enabled", () => {
  const segments = buildFimSegments(sampleContext, true);
  assert.ok(segments);
  assert.match(segments!.prefix, /import fs/);
  assert.match(segments!.prefix, /const value = /);
  assert.equal(segments!.suffix, "1;\nnext();");
});

test("buildFimSegments is undefined when useFim disabled", () => {
  assert.equal(buildFimSegments(sampleContext, false), undefined);
});

test("synthesizeMessageFromSegments builds chat-fallback prompt from FIM segments", () => {
  const segments = { prefix: "const x = ", suffix: ";" };
  const message = synthesizeMessageFromSegments(segments, sampleContext, "fallback");
  assert.match(message, /PREFIX:/);
  assert.match(message, /const x = /);
  assert.match(message, /SUFFIX:/);
  assert.match(message, /TASK:/);
  assert.match(message, /GROUNDING:/);
  assert.match(message, /Do NOT invent string literals/i);
});

async function runAsyncTests(): Promise<void> {
  await asyncTest("reuses in-flight promise for prefix-compatible extension", async () => {
    let requestCount = 0;
    const api = {
      streamInlineCompletion: async () => {
        requestCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { text: "value;", alternatives: [], model: "test", provider: "anthropic" };
      }
    };
    const performance = new AutocompletePerformanceMonitor();
    const router = new CompletionRouter({ api: api as never, performance });

    const baseContext: ExtractedCodeContext = {
      ...sampleContext,
      contextHash: "hash-base",
      currentLinePrefix: "const "
    };
    const extendedContext: ExtractedCodeContext = {
      ...sampleContext,
      contextHash: "hash-extended",
      currentLinePrefix: "const v"
    };

    const first = router.fetchCompletions(baseContext, autocompleteSettings);
    const second = router.fetchCompletions(extendedContext, autocompleteSettings);
    await Promise.all([first, second]);

    assert.equal(requestCount, 1);
  });

  await asyncTest("uses higher maxTokens for multi-line brace context", async () => {
    let capturedMaxTokens = 0;
    const api = {
      streamInlineCompletion: async (_base: string, body: { maxTokens: number }) => {
        capturedMaxTokens = body.maxTokens;
        return { text: "  return 1;\n}", alternatives: [], model: "test", provider: "anthropic" };
      }
    };
    const performance = new AutocompletePerformanceMonitor();
    const router = new CompletionRouter({ api: api as never, performance });

    const braceContext: ExtractedCodeContext = {
      ...sampleContext,
      contextHash: "hash-brace",
      currentLinePrefix: "function foo() {"
    };

    await router.fetchCompletions(braceContext, autocompleteSettings);
    assert.equal(capturedMaxTokens, 200);
  });

  await asyncTest("starts new request when prefix is not compatible", async () => {
    let requestCount = 0;
    const api = {
      streamInlineCompletion: async () => {
        requestCount += 1;
        return { text: "ok;", alternatives: [], model: "test", provider: "anthropic" };
      }
    };
    const performance = new AutocompletePerformanceMonitor();
    const router = new CompletionRouter({ api: api as never, performance });

    const ctxA: ExtractedCodeContext = {
      ...sampleContext,
      contextHash: "hash-a",
      currentLinePrefix: "let "
    };
    const ctxB: ExtractedCodeContext = {
      ...sampleContext,
      contextHash: "hash-b",
      currentLinePrefix: "const "
    };

    await router.fetchCompletions(ctxA, autocompleteSettings);
    await router.fetchCompletions(ctxB, autocompleteSettings);

    assert.equal(requestCount, 2);
  });

  await asyncTest("includes graph context fields when useGraphContext is enabled", async () => {
    setMockConfiguration("coopAI", "defaultOwner", "acme");
    setMockConfiguration("coopAI", "defaultRepo", "app");
    setMockConfiguration("coopAI", "defaultCodeHost", "github");

    let capturedBody: Record<string, unknown> | undefined;
    const api = {
      streamInlineCompletion: async (_base: string, body: Record<string, unknown>) => {
        capturedBody = body;
        return { text: "value;", alternatives: [], model: "test", provider: "anthropic" };
      }
    };
    const performance = new AutocompletePerformanceMonitor();
    const router = new CompletionRouter({ api: api as never, performance });

    await router.fetchCompletions(sampleContext, {
      ...autocompleteSettings,
      useGraphContext: true
    });

    assert.equal(capturedBody?.useGraphContext, true);
    assert.equal(capturedBody?.repoId, "github:acme/app");
    assert.equal(capturedBody?.file, "src/app.ts");
  });

  await asyncTest("omits graph context fields when useGraphContext is disabled", async () => {
    setMockConfiguration("coopAI", "defaultOwner", "acme");
    setMockConfiguration("coopAI", "defaultRepo", "app");

    let capturedBody: Record<string, unknown> | undefined;
    const api = {
      streamInlineCompletion: async (_base: string, body: Record<string, unknown>) => {
        capturedBody = body;
        return { text: "value;", alternatives: [], model: "test", provider: "anthropic" };
      }
    };
    const performance = new AutocompletePerformanceMonitor();
    const router = new CompletionRouter({ api: api as never, performance });

    await router.fetchCompletions(sampleContext, autocompleteSettings);

    assert.equal(capturedBody?.useGraphContext, undefined);
    assert.equal(capturedBody?.repoId, undefined);
  });

  await asyncTest("auto-includes graph context when index is healthy", async () => {
    setMockConfiguration("coopAI", "defaultOwner", "acme");
    setMockConfiguration("coopAI", "defaultRepo", "app");
    setMockConfiguration("coopAI", "defaultCodeHost", "github");

    let capturedBody: Record<string, unknown> | undefined;
    const api = {
      streamInlineCompletion: async (_base: string, body: Record<string, unknown>) => {
        capturedBody = body;
        return { text: "value;", alternatives: [], model: "test", provider: "anthropic" };
      }
    };
    const indexBackend = {
      getRepoStatus: async () => ({
        repoId: "github:acme/app",
        enabled: true,
        status: "ready" as const,
        zoektAvailable: true,
        scipAvailable: false
      })
    };
    const performance = new AutocompletePerformanceMonitor();
    const router = new CompletionRouter({
      api: api as never,
      performance,
      indexBackend: indexBackend as never
    });

    await router.fetchCompletions(sampleContext, autocompleteSettings);

    assert.equal(capturedBody?.useGraphContext, true);
    assert.equal(capturedBody?.repoId, "github:acme/app");
    assert.equal(capturedBody?.file, "src/app.ts");
  });

  await asyncTest("falls back to secondary provider when primary request fails", async () => {
    setMockConfiguration("coopAI", "devMode", false);
    let attempt = 0;
    const api = {
      streamInlineCompletion: async (_base: string, body: { provider: string }) => {
        attempt += 1;
        if (body.provider === "mistral") {
          throw new Error("primary failed");
        }
        return { text: "fallback;", alternatives: [], model: "mini", provider: "openai" };
      }
    };
    const performance = new AutocompletePerformanceMonitor();
    const router = new CompletionRouter({ api: api as never, performance });

    const result = await router.fetchCompletions(sampleContext, autocompleteSettings);
    assert.equal(attempt, 2);
    assert.equal(result.completions[0]?.text, "fallback;");
    assert.equal(result.provider, "openai");
  });

  await asyncTest("returns cached completions without a network request", async () => {
    let requestCount = 0;
    const api = {
      streamInlineCompletion: async () => {
        requestCount += 1;
        return { text: "cached;", alternatives: [], model: "test", provider: "anthropic" };
      }
    };
    const performance = new AutocompletePerformanceMonitor();
    const router = new CompletionRouter({ api: api as never, performance });

    const context: ExtractedCodeContext = {
      ...sampleContext,
      contextHash: "cache-hash"
    };

    await router.fetchCompletions(context, autocompleteSettings);
    const cached = await router.fetchCompletions(context, autocompleteSettings);

    assert.equal(requestCount, 1);
    assert.equal(cached.fromCache, true);
    assert.equal(cached.completions[0]?.text, "cached;");
  });

  await asyncTest("uses assigned autocomplete model in production", async () => {
    setMockConfiguration("coopAI", "llmProvider", "openai");
    setMockConfiguration("coopAI", "defaultModel", "gpt-4o");
    setMockConfiguration("coopAI", "devMode", false);

    let capturedBody: Record<string, unknown> | undefined;
    const api = {
      streamInlineCompletion: async (_base: string, body: Record<string, unknown>) => {
        capturedBody = body;
        return { text: "42;", alternatives: [], model: "codestral-latest", provider: "mistral" };
      }
    };
    const performance = new AutocompletePerformanceMonitor();
    const router = new CompletionRouter({ api: api as never, performance });

    await router.fetchCompletions(sampleContext, {
      ...autocompleteSettings,
      model: "chat"
    });

    assert.equal(capturedBody?.provider, "mistral");
    assert.equal(capturedBody?.model, "codestral-latest");
  });

  await asyncTest("uses chat preferences model when dev mode is on", async () => {
    setMockConfiguration("coopAI", "llmProvider", "openai");
    setMockConfiguration("coopAI", "defaultModel", "gpt-4o");
    setMockConfiguration("coopAI", "devMode", true);

    let capturedBody: Record<string, unknown> | undefined;
    const api = {
      streamInlineCompletion: async (_base: string, body: Record<string, unknown>) => {
        capturedBody = body;
        return { text: "42;", alternatives: [], model: "gpt-4o", provider: "openai" };
      }
    };
    const performance = new AutocompletePerformanceMonitor();
    const router = new CompletionRouter({ api: api as never, performance });

    await router.fetchCompletions(sampleContext, {
      ...autocompleteSettings,
      model: "chat"
    });

    assert.equal(capturedBody?.provider, "openai");
    assert.equal(capturedBody?.model, "gpt-4o");
  });

  await asyncTest("returns empty completions with timeout error when request times out", async () => {
    const api = {
      streamInlineCompletion: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { text: "late;", alternatives: [], model: "test", provider: "anthropic" };
      }
    };
    const performance = new AutocompletePerformanceMonitor();
    const router = new CompletionRouter({ api: api as never, performance });

    const result = await router.fetchCompletions(sampleContext, {
      ...autocompleteSettings,
      requestTimeoutMs: 20
    });

    assert.equal(result.completions.length, 0);
    assert.match(result.error ?? "", /timed out/i);
  });
}

void runAsyncTests().then(() => {
  console.log(`\ncompletionRouter: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
});
