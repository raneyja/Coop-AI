import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import {
  INLINE_MODEL_PRESETS,
  defaultInlineModelForProvider,
  resolveInlineModelPreset
} from "../config/inlineModelPresets";
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

test("haiku preset targets anthropic haiku with openai fallback", () => {
  const preset = resolveInlineModelPreset("haiku", "", "anthropic");
  assert.equal(preset.provider, "anthropic");
  assert.equal(preset.model, INLINE_MODEL_PRESETS.haiku.model);
  assert.equal(preset.fallback?.provider, "openai");
});

test("gpt35 preset targets openai mini with anthropic fallback", () => {
  const preset = resolveInlineModelPreset("gpt35", "", "openai");
  assert.equal(preset.provider, "openai");
  assert.equal(preset.model, INLINE_MODEL_PRESETS.gpt35.model);
  assert.equal(preset.fallback?.provider, "anthropic");
});

test("custom preset uses trimmed model id and haiku fallback", () => {
  const preset = resolveInlineModelPreset("custom", "  my-model  ", "openai");
  assert.equal(preset.provider, "openai");
  assert.equal(preset.model, "my-model");
  assert.ok(preset.fallback);
});

test("defaultInlineModelForProvider aligns extension and server defaults", () => {
  assert.equal(defaultInlineModelForProvider("anthropic"), INLINE_MODEL_PRESETS.haiku.model);
  assert.equal(defaultInlineModelForProvider("openai"), INLINE_MODEL_PRESETS.gpt35.model);
});

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
});

const autocompleteSettings: AutocompleteSettings = {
  enabled: true,
  trigger: "auto",
  maxSuggestionLength: 200,
  debounceMs: 300,
  model: "haiku",
  customModel: "",
  copilotPolicy: "warn",
  showMultipleSuggestions: false,
  requestTimeoutMs: 5_000,
  useFim: true
};

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
}

void runAsyncTests().then(() => {
  console.log(`\ncompletionRouter: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
});
