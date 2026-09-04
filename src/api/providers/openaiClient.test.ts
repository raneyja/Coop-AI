import assert from "node:assert/strict";
import test from "node:test";
import { applyOpenAiThinking, parseOpenAiSseLine } from "./openaiClient";
import type { ParseState } from "./baseClient";

function state(): ParseState {
  return { text: "" };
}

test("parseOpenAiSseLine yields thinking from reasoning_content", () => {
  const chunk = parseOpenAiSseLine(
    `data: ${JSON.stringify({
      choices: [{ delta: { reasoning_content: "Step one…" }, index: 0 }]
    })}`,
    state()
  );
  assert.deepEqual(chunk, { type: "thinking", text: "Step one…" });
});

test("parseOpenAiSseLine still yields content deltas", () => {
  const chunk = parseOpenAiSseLine(
    `data: ${JSON.stringify({
      choices: [{ delta: { content: "Answer" }, index: 0 }]
    })}`,
    state()
  );
  assert.deepEqual(chunk, { type: "delta", text: "Answer" });
});

test("applyOpenAiThinking only sets reasoning_effort for GPT-5 thinking mode", () => {
  assert.deepEqual(
    applyOpenAiThinking({ model: "gpt-5.1" }, { mode: "openai-reasoning", effort: "medium" }).reasoning_effort,
    "medium"
  );
  assert.equal(
    "reasoning_effort" in applyOpenAiThinking({ model: "gpt-4o-mini" }, { mode: "adaptive" }),
    false
  );
});
