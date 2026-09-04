import assert from "node:assert/strict";
import test from "node:test";
import { applyAnthropicThinking, parseAnthropicLine } from "./anthropicClient";
import type { ParseState } from "./baseClient";

function state(): ParseState {
  return { text: "" };
}

test("parseAnthropicLine yields thinking chunks from thinking_delta", () => {
  const chunk = parseAnthropicLine(
    `data: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "Checking call sites…" }
    })}`,
    state()
  );
  assert.deepEqual(chunk, { type: "thinking", text: "Checking call sites…" });
});

test("parseAnthropicLine yields answer deltas from text_delta", () => {
  const chunk = parseAnthropicLine(
    `data: ${JSON.stringify({
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "Hello" }
    })}`,
    state()
  );
  assert.deepEqual(chunk, { type: "delta", text: "Hello" });
});

test("applyAnthropicThinking uses adaptive + effort for Opus 4.8", () => {
  const applied = applyAnthropicThinking(
    { model: "claude-opus-4-8", stream: true },
    {
      model: "claude-opus-4-8",
      maxTokens: 16_000,
      thinking: { mode: "adaptive", effort: "high" }
    }
  );
  assert.deepEqual(applied.body.thinking, { type: "adaptive" });
  assert.deepEqual(applied.body.output_config, { effort: "high" });
  assert.equal(applied.forceTemperature, 1);
  const thinking = applied.body.thinking as { type?: string; budget_tokens?: number };
  assert.notEqual(thinking.type, "enabled");
  assert.equal(thinking.budget_tokens, undefined);
});

test("applyAnthropicThinking uses enabled + budget for Haiku 4.5", () => {
  const applied = applyAnthropicThinking(
    { model: "claude-haiku-4-5-20251001", stream: true },
    {
      model: "claude-haiku-4-5-20251001",
      maxTokens: 16_000,
      thinking: { mode: "extended", budgetTokens: 1024 }
    }
  );
  assert.deepEqual(applied.body.thinking, { type: "enabled", budget_tokens: 1024 });
  assert.equal(applied.body.output_config, undefined);
  assert.equal(applied.forceTemperature, 1);
  assert.equal(applied.maxTokens, 16_000);
});

test("applyAnthropicThinking uses adaptive for Sonnet 4.6", () => {
  const applied = applyAnthropicThinking(
    { model: "claude-sonnet-4-6", stream: true },
    {
      model: "claude-sonnet-4-6",
      maxTokens: 16_000,
      thinking: { mode: "adaptive", effort: "high" }
    }
  );
  assert.deepEqual(applied.body.thinking, { type: "adaptive" });
  assert.deepEqual(applied.body.output_config, { effort: "high" });
  assert.equal(applied.forceTemperature, 1);
});

test("applyAnthropicThinking ignores OpenAI/Gemini thinking modes", () => {
  const applied = applyAnthropicThinking(
    { model: "claude-opus-4-8" },
    {
      model: "claude-opus-4-8",
      maxTokens: 16_000,
      thinking: { mode: "openai-reasoning", effort: "medium" }
    }
  );
  assert.equal(applied.body.thinking, undefined);
  assert.equal(applied.forceTemperature, undefined);
});

test("parseAnthropicLine ignores signature_delta", () => {
  const chunk = parseAnthropicLine(
    `data: ${JSON.stringify({
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "abc" }
    })}`,
    state()
  );
  assert.equal(chunk, undefined);
});
