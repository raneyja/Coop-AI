import assert from "node:assert/strict";
import test from "node:test";
import { COOP_FEATURE_MODEL_ASSIGNMENTS } from "./featureModelAssignments";
import { listCatalogModels, listPickerCatalogModels } from "./llmModels";
import {
  CATALOG_THINKING_KIND,
  inferThinkingKind,
  missingCatalogThinkingIds,
  resolveProviderThinking
} from "./modelThinking";
import { applyAnthropicThinking } from "../api/providers/anthropicClient";
import { applyOpenAiThinking } from "../api/providers/openaiClient";
import { applyGeminiThinking } from "../api/providers/geminiClient";

test("every catalog model has an explicit thinking contract", () => {
  assert.deepEqual(missingCatalogThinkingIds(), []);
  const catalogIds = new Set(listCatalogModels().map((entry) => entry.id));
  for (const id of Object.keys(CATALOG_THINKING_KIND)) {
    assert.equal(catalogIds.has(id), true, `stale thinking row for ${id}`);
  }
});

test("Auto assignments are covered by the same catalog contracts", () => {
  for (const assignment of COOP_FEATURE_MODEL_ASSIGNMENTS) {
    assert.notEqual(
      CATALOG_THINKING_KIND[assignment.model],
      undefined,
      `assignment ${assignment.feature} model ${assignment.model} missing thinking row`
    );
  }
});

test("picker Claude models never send thinking.type.enabled except Haiku", () => {
  const maxTokens = 16_000;
  for (const entry of listPickerCatalogModels().filter((model) => model.provider === "anthropic")) {
    const thinking = resolveProviderThinking(entry.provider, entry.id, maxTokens);
    const applied = applyAnthropicThinking({ model: entry.id }, { model: entry.id, maxTokens, thinking });
    const block = applied.body.thinking as { type?: string; budget_tokens?: number } | undefined;
    if (entry.id === "claude-haiku-4-5-20251001") {
      assert.deepEqual(block, { type: "enabled", budget_tokens: 1024 });
      assert.equal(applied.forceTemperature, 1);
      continue;
    }
    assert.equal(block?.type, "adaptive");
    assert.equal(block?.budget_tokens, undefined);
    assert.deepEqual(applied.body.output_config, { effort: "high" });
    assert.equal(applied.forceTemperature, 1);
  }
});

test("GPT-5 picker models get reasoning_effort; GPT-4o mini does not", () => {
  const gpt51 = resolveProviderThinking("openai", "gpt-5.1", 16_000);
  const gpt55 = resolveProviderThinking("openai", "gpt-5.5", 16_000);
  const mini = resolveProviderThinking("openai", "gpt-5-mini", 16_000);
  const classic = resolveProviderThinking("openai", "gpt-4o-mini", 16_000);
  assert.deepEqual(applyOpenAiThinking({ model: "gpt-5.1" }, gpt51).reasoning_effort, "medium");
  assert.deepEqual(applyOpenAiThinking({ model: "gpt-5.5" }, gpt55).reasoning_effort, "medium");
  assert.deepEqual(applyOpenAiThinking({ model: "gpt-5-mini" }, mini).reasoning_effort, "medium");
  assert.equal("reasoning_effort" in applyOpenAiThinking({ model: "gpt-4o-mini" }, classic), false);
});

test("Gemini 2.5 asks for thought parts; Gemini 2.0 does not", () => {
  const flash25 = resolveProviderThinking("gemini", "gemini-2.5-flash", 16_000);
  const pro = resolveProviderThinking("gemini", "gemini-2.5-pro", 16_000);
  const flash20 = resolveProviderThinking("gemini", "gemini-2.0-flash", 16_000);
  const withThoughts = applyGeminiThinking({ generationConfig: { temperature: 0.5 } }, flash25);
  assert.deepEqual((withThoughts.generationConfig as { thinkingConfig?: unknown }).thinkingConfig, {
    includeThoughts: true
  });
  assert.deepEqual(
    (applyGeminiThinking({ generationConfig: {} }, pro).generationConfig as { thinkingConfig?: unknown })
      .thinkingConfig,
    { includeThoughts: true }
  );
  assert.equal(
    "thinkingConfig" in
      ((applyGeminiThinking({ generationConfig: {} }, flash20).generationConfig as object) ?? {}),
    false
  );
});

test("DeepSeek Reasoner and Codestral do not send extra thinking request fields", () => {
  assert.equal(resolveProviderThinking("deepseek", "deepseek-reasoner", 16_000), undefined);
  assert.equal(inferThinkingKind("deepseek", "deepseek-reasoner"), "parse-only");
  assert.equal(resolveProviderThinking("mistral", "codestral-latest", 16_000), undefined);
  assert.equal(inferThinkingKind("mistral", "codestral-latest"), "none");
});
