import assert from "node:assert/strict";
import test from "node:test";
import {
  ANTHROPIC_THINKING_BUDGET_TOKENS,
  resolveAnthropicThinkingBudget
} from "./chatThinkingBudget";

test("resolveAnthropicThinkingBudget returns floor when maxTokens allows it", () => {
  assert.equal(resolveAnthropicThinkingBudget(2000), ANTHROPIC_THINKING_BUDGET_TOKENS);
});

test("resolveAnthropicThinkingBudget refuses when maxTokens is too small", () => {
  assert.equal(resolveAnthropicThinkingBudget(1024), undefined);
  assert.equal(resolveAnthropicThinkingBudget(500), undefined);
});
