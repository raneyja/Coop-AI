import assert from "node:assert/strict";
import test from "node:test";
import { applyGeminiThinking, parseGeminiParts } from "./geminiClient";

test("applyGeminiThinking only adds includeThoughts for gemini-thoughts mode", () => {
  const applied = applyGeminiThinking(
    { generationConfig: { temperature: 0.5, maxOutputTokens: 1024 } },
    { mode: "gemini-thoughts" }
  );
  assert.deepEqual(applied.generationConfig, {
    temperature: 0.5,
    maxOutputTokens: 1024,
    thinkingConfig: { includeThoughts: true }
  });
  const skipped = applyGeminiThinking({ generationConfig: { temperature: 0.5 } }, { mode: "adaptive" });
  assert.equal("thinkingConfig" in (skipped.generationConfig as object), false);
});

test("parseGeminiParts splits thought parts from answer text", () => {
  assert.deepEqual(
    parseGeminiParts([
      { thought: true, text: "Checking the config…" },
      { text: "This file sets up the container." }
    ]),
    [
      { type: "thinking", text: "Checking the config…" },
      { type: "delta", text: "This file sets up the container." }
    ]
  );
});
