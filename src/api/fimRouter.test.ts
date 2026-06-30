import assert from "node:assert/strict";
import { selectFimProvider } from "./fimRouter";
import type { LlmServerConfig } from "./llmServerConfig";
import { FIM_DEEPSEEK_MODEL, FIM_MISTRAL_MODEL } from "../config/inlineModelPresets";

function baseConfig(overrides: Partial<LlmServerConfig> = {}): LlmServerConfig {
  return {
    defaultProvider: "anthropic",
    mockMode: false,
    allowUnapprovedProvider: false,
    apiKeys: {},
    ...overrides
  };
}

let passed = 0;

assert.deepEqual(
  selectFimProvider(baseConfig(), { segments: { prefix: "const x = ", suffix: ";" } }),
  { mode: "chat-fallback", provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  "no FIM keys falls back to chat"
);
passed++;

assert.deepEqual(
  selectFimProvider(baseConfig({ apiKeys: { mistral: "test-key" } }), {
    segments: { prefix: "function f() {", suffix: "}" }
  }),
  { mode: "fim", provider: "mistral", model: FIM_MISTRAL_MODEL },
  "mistral key prefers Codestral FIM"
);
passed++;

assert.deepEqual(
  selectFimProvider(baseConfig({ apiKeys: { deepseek: "test-key" } }), {
    segments: { prefix: "def fib(a):", suffix: "return a" }
  }),
  { mode: "fim", provider: "deepseek", model: FIM_DEEPSEEK_MODEL },
  "deepseek key uses FIM when mistral absent"
);
passed++;

assert.deepEqual(
  selectFimProvider(baseConfig({ apiKeys: { mistral: "m", deepseek: "d" } }), {
    segments: { prefix: "x", suffix: "y" }
  }),
  { mode: "fim", provider: "mistral", model: FIM_MISTRAL_MODEL },
  "mistral wins over deepseek"
);
passed++;

assert.deepEqual(
  selectFimProvider(baseConfig({ mockMode: true }), {
    segments: { prefix: "x", suffix: "" }
  }),
  { mode: "fim", provider: "mistral", model: FIM_MISTRAL_MODEL },
  "mock mode enables FIM routing"
);
passed++;

assert.deepEqual(
  selectFimProvider(baseConfig({ apiKeys: { mistral: "k" } }), {}),
  { mode: "chat-fallback", provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  "missing segments uses chat fallback"
);
passed++;

console.log(`fimRouter: ${passed}/${passed} tests passed`);
