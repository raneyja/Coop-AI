import assert from "node:assert/strict";
import {
  FIM_DEEPSEEK_MODEL,
  FIM_MISTRAL_MODEL,
  INLINE_DEFAULT_MODEL_BY_PROVIDER,
  INLINE_MODEL_PRESETS,
  defaultInlineModelForProvider,
  resolveChatModelPreset,
  resolveInlineModelPreset
} from "./inlineModelPresets";

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

test("chat preset uses preferences provider and model", () => {
  const preset = resolveChatModelPreset("openai", "gpt-4o");
  assert.equal(preset.provider, "openai");
  assert.equal(preset.model, "gpt-4o");
  assert.ok(preset.fallback);
});

test("chat preset falls back to provider default when model empty", () => {
  const preset = resolveChatModelPreset("openai", "  ");
  assert.equal(preset.model, INLINE_MODEL_PRESETS.gpt35.model);
});

test("resolveInlineModelPreset chat delegates to chat model preset", () => {
  const preset = resolveInlineModelPreset("chat", "", "openai", "gpt-4o");
  assert.equal(preset.model, "gpt-4o");
});

test("haiku preset targets anthropic haiku with openai fallback", () => {
  const preset = resolveInlineModelPreset("haiku", "", "anthropic");
  assert.equal(preset.provider, "anthropic");
  assert.equal(preset.model, INLINE_MODEL_PRESETS.haiku.model);
  assert.equal(preset.fallback?.provider, "openai");
  assert.equal(preset.fallback?.model, INLINE_MODEL_PRESETS.gpt35.model);
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

test("custom preset without model id falls back to haiku", () => {
  const preset = resolveInlineModelPreset("custom", "   ", "openai");
  assert.deepEqual(preset, INLINE_MODEL_PRESETS.haiku);
});

test("defaultInlineModelForProvider aligns extension and server defaults", () => {
  assert.equal(defaultInlineModelForProvider("anthropic"), INLINE_MODEL_PRESETS.haiku.model);
  assert.equal(defaultInlineModelForProvider("openai"), INLINE_MODEL_PRESETS.gpt35.model);
  assert.equal(defaultInlineModelForProvider("gemini"), "gemini-2.0-flash");
  assert.equal(defaultInlineModelForProvider("mistral"), FIM_MISTRAL_MODEL);
  assert.equal(defaultInlineModelForProvider("deepseek"), FIM_DEEPSEEK_MODEL);
});

test("INLINE_DEFAULT_MODEL_BY_PROVIDER covers all supported providers", () => {
  assert.equal(INLINE_DEFAULT_MODEL_BY_PROVIDER.anthropic, INLINE_MODEL_PRESETS.haiku.model);
  assert.equal(INLINE_DEFAULT_MODEL_BY_PROVIDER.openai, INLINE_MODEL_PRESETS.gpt35.model);
  assert.ok(INLINE_DEFAULT_MODEL_BY_PROVIDER.gemini.length > 0);
});

console.log(`\ninlineModelPresets: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
