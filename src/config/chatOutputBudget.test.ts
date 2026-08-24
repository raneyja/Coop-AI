import assert from "node:assert/strict";
import {
  CHAT_OUTPUT_MAX_TOKENS_CAP,
  CHAT_OUTPUT_MAX_TOKENS_DEFAULT,
  GPT5_REASONING_COMPLETION_RESERVE,
  LEGACY_CHAT_OUTPUT_MAX_TOKENS,
  openaiCompletionTokenBudget,
  resolveChatOutputMaxTokens
} from "./chatOutputBudget";

let passed = 0;

function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

test("missing or non-finite maxTokens uses the chat default", () => {
  assert.equal(resolveChatOutputMaxTokens(undefined), CHAT_OUTPUT_MAX_TOKENS_DEFAULT);
  assert.equal(resolveChatOutputMaxTokens(Number.NaN), CHAT_OUTPUT_MAX_TOKENS_DEFAULT);
});

test("legacy 2000 default is treated as unset so long answers are not cut off", () => {
  assert.equal(resolveChatOutputMaxTokens(LEGACY_CHAT_OUTPUT_MAX_TOKENS), CHAT_OUTPUT_MAX_TOKENS_DEFAULT);
  assert.equal(resolveChatOutputMaxTokens(2000), CHAT_OUTPUT_MAX_TOKENS_DEFAULT);
});

test("explicit small budgets (planner) and larger user budgets are preserved", () => {
  assert.equal(resolveChatOutputMaxTokens(600), 600);
  assert.equal(resolveChatOutputMaxTokens(4096), 4096);
  assert.equal(resolveChatOutputMaxTokens(99), 256);
  assert.equal(resolveChatOutputMaxTokens(99_000), CHAT_OUTPUT_MAX_TOKENS_CAP);
});

test("GPT-5 chat completions reserve tokens for hidden reasoning", () => {
  assert.equal(
    openaiCompletionTokenBudget(CHAT_OUTPUT_MAX_TOKENS_DEFAULT, "gpt-5-mini"),
    CHAT_OUTPUT_MAX_TOKENS_DEFAULT + GPT5_REASONING_COMPLETION_RESERVE
  );
  assert.equal(openaiCompletionTokenBudget(600, "gpt-5-mini"), 600);
  assert.equal(openaiCompletionTokenBudget(8192, "gpt-4o"), 8192);
});

console.log(`\nchatOutputBudget: ${passed} passed`);
