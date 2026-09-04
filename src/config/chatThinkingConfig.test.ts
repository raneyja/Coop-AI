import assert from "node:assert/strict";
import test from "node:test";
import {
  ANTHROPIC_THINKING_BUDGET_TOKENS,
  anthropicUsesAdaptiveThinking,
  resolveAnthropicThinking,
  resolveAnthropicThinkingBudget
} from "./chatThinkingBudget";

test("resolveAnthropicThinkingBudget returns floor when maxTokens allows it", () => {
  assert.equal(resolveAnthropicThinkingBudget(2000), ANTHROPIC_THINKING_BUDGET_TOKENS);
});

test("resolveAnthropicThinkingBudget refuses when maxTokens is too small", () => {
  assert.equal(resolveAnthropicThinkingBudget(1024), undefined);
  assert.equal(resolveAnthropicThinkingBudget(500), undefined);
});

test("Opus 4.8 and Sonnet 4.6 use adaptive thinking, not enabled+budget", () => {
  assert.equal(anthropicUsesAdaptiveThinking("claude-opus-4-8"), true);
  assert.equal(anthropicUsesAdaptiveThinking("claude-sonnet-4-6"), true);
  assert.deepEqual(resolveAnthropicThinking("claude-opus-4-8", 16_000), {
    mode: "adaptive",
    effort: "high"
  });
  assert.deepEqual(resolveAnthropicThinking("claude-sonnet-4-6", 16_000), {
    mode: "adaptive",
    effort: "high"
  });
});

test("Haiku 4.5 still uses extended thinking with a budget", () => {
  assert.equal(anthropicUsesAdaptiveThinking("claude-haiku-4-5-20251001"), false);
  assert.deepEqual(resolveAnthropicThinking("claude-haiku-4-5-20251001", 16_000), {
    mode: "extended",
    budgetTokens: ANTHROPIC_THINKING_BUDGET_TOKENS
  });
});

test("older Claude 4.5 models must not receive adaptive thinking", () => {
  assert.equal(anthropicUsesAdaptiveThinking("claude-opus-4-5"), false);
  assert.equal(anthropicUsesAdaptiveThinking("claude-sonnet-4-5"), false);
});
