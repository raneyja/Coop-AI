import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import {
  INLINE_MODEL_PRESETS,
  defaultInlineModelForProvider,
  resolveInlineModelPreset
} from "../config/inlineModelPresets";

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

console.log(`\ncompletionRouter: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
