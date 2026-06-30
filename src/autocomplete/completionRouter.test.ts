import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import {
  INLINE_MODEL_PRESETS,
  defaultInlineModelForProvider,
  resolveInlineModelPreset
} from "../config/inlineModelPresets";
import { buildFimSegments } from "./completionRouter";
import type { ExtractedCodeContext } from "./types";

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

console.log(`\ncompletionRouter: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
