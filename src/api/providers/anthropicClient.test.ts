import assert from "node:assert/strict";
import test from "node:test";
import { parseAnthropicLine } from "./anthropicClient";
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
