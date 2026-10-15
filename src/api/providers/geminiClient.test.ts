import assert from "node:assert/strict";
import test from "node:test";
import { GeminiProviderClient, applyGeminiThinking, geminiBilledOutputTokens, parseGeminiParts } from "./geminiClient";
import type { ProviderStreamOptions, StreamChunk } from "../types";

const sourceOptions: ProviderStreamOptions = {model: "gemini-2.5-flash", messages: [{role: "user", content: "Explain the inspected source."}],
  temperature: 0.5, maxTokens: 8192, requestId: "source-fixture", requireCompletedMessage: true};
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const delta = event({candidates: [{content: {parts: [{text: "Complete-looking answer."}]}}],
  usageMetadata: {promptTokenCount: 32, candidatesTokenCount: 10, thoughtsTokenCount: 4}});
async function collect(body: string | ReadableStream<Uint8Array>, options = sourceOptions) {
  const client = new GeminiProviderClient("gemini", {apiKey: "test-only", fetchImpl: async () => new Response(body)});
  const chunks: StreamChunk[] = [];
  for await (const chunk of client.streamCompletion(options)) chunks.push(chunk);
  return chunks;
}

test("source Gemini requires native STOP, preserves thinking and parses an unterminated final SSE line", async () => {
  const body = event({candidates: [{content: {parts: [{thought: true, text: "Private reasoning"}, {text: "☃😀"}]}, finishReason: "STOP"}],
    usageMetadata: {promptTokenCount: 32, candidatesTokenCount: 10, thoughtsTokenCount: 4}}).trimEnd();
  const bytes = new TextEncoder().encode(body), split = bytes.indexOf(0xf0) + 2;
  const chunks = await collect(new ReadableStream({start(stream) {stream.enqueue(bytes.slice(0, split)); stream.enqueue(bytes.slice(split)); stream.close();}}));
  assert.deepEqual(chunks.filter(chunk => chunk.type === "thinking" || chunk.type === "delta").map(chunk => chunk.text), ["Private reasoning", "☃😀"]);
  const done = chunks.find(chunk => chunk.type === "done");
  assert.equal(done?.finishReason, "stop"); assert.equal(done?.usage.inputTokens, 32); assert.equal(done?.usage.outputTokens, 14);
  assert(!chunks.some(chunk => chunk.type === "error"));
});

test("source Gemini does not certify missing, unspecified, malformed, conflicting or unsupported completion", async () => {
  for (const body of [delta, delta + event({candidates: [{finishReason: "FINISH_REASON_UNSPECIFIED"}]}),
    delta + 'data: {"candidates":', delta + event({candidates: [{finishReason: "SAFETY"}]}),
    delta + event({candidates: [{finishReason: "NEW_UNKNOWN_REASON"}]}),
    delta + event({candidates: {0: {finishReason: "STOP"}}}),
    delta + event({candidates: [{finishReason: 42}]}),
    delta + event({candidates: [{finishReason: "MAX_TOKENS"}]}) + event({candidates: [{finishReason: "STOP"}]})]) {
    const chunks = await collect(body);
    const done = chunks.find(chunk => chunk.type === "done");
    assert.equal(done?.finishReason, "error"); assert.equal(done?.usage.inputTokens, 32); assert.equal(done?.usage.outputTokens, 14);
    assert(chunks.some(chunk => chunk.type === "error"));
  }
});

test("source Gemini maps MAX_TOKENS to length rather than successful completion", async () => {
  const chunks = await collect(delta + event({candidates: [{finishReason: "MAX_TOKENS"}]}).trimEnd());
  assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, "length");
  assert(!chunks.some(chunk => chunk.type === "error"));
});

test("source Gemini provider and reader errors preserve known usage, including after STOP", async () => {
  for (const afterStop of [false, true]) {
    const chunks = await collect(delta + (afterStop ? event({candidates: [{finishReason: "STOP"}]}) : "") + event({error: {code: 500, message: "failed"}}));
    assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, "error");
    assert.equal(chunks.find(chunk => chunk.type === "done")?.usage.outputTokens, 14);
  }
  let pulled = false;
  const chunks = await collect(new ReadableStream({pull(stream) {if (!pulled) {pulled = true; stream.enqueue(new TextEncoder().encode(delta));}
    else stream.error(new Error("interrupted"));}}));
  assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, "error");
  assert.equal(chunks.find(chunk => chunk.type === "done")?.usage.inputTokens, 32);
});

test("source Gemini user Stop cancels without later deltas and retains returned usage", async () => {
  const controller = new AbortController();
  const body = event({candidates: [{content: {parts: [{text: "first"}, {text: "must remain unseen"}]}, finishReason: "STOP"}],
    usageMetadata: {promptTokenCount: 32, candidatesTokenCount: 10, thoughtsTokenCount: 4}});
  const client = new GeminiProviderClient("gemini", {apiKey: "test-only", fetchImpl: async () => new Response(body)});
  const chunks: StreamChunk[] = [];
  for await (const chunk of client.streamCompletion({...sourceOptions, signal: controller.signal})) {
    chunks.push(chunk); if (chunk.type === "delta") controller.abort();
  }
  assert.deepEqual(chunks.filter(chunk => chunk.type === "delta").map(chunk => chunk.text), ["first"]);
  assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, "cancelled");
  assert.equal(chunks.find(chunk => chunk.type === "done")?.usage.outputTokens, 14);
  assert(!chunks.some(chunk => chunk.type === "error"));
});

test("source Gemini cannot accept truncated UTF8 and does not expose query keys in transport errors", async () => {
  const tail = new TextEncoder().encode('data: {"text":"😀');
  const chunks = await collect(new ReadableStream({start(stream) {stream.enqueue(new TextEncoder().encode(delta)); stream.enqueue(tail.slice(0, -1)); stream.close();}}));
  assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, "error");
  assert.equal(chunks.find(chunk => chunk.type === "done")?.usage.outputTokens, 14);
  const key = "test-only-private-key";
  const client = new GeminiProviderClient("gemini", {apiKey: key, fetchImpl: async url => {throw new Error(String(url));}});
  const failures: StreamChunk[] = [];
  for await (const chunk of client.streamCompletion(sourceOptions)) failures.push(chunk);
  assert(!JSON.stringify(failures).includes(key));
});

test("ordinary Gemini EOF contract remains unchanged without the trusted source-completion option", async () => {
  for (const body of [delta, delta + event({candidates: [{finishReason: "MAX_TOKENS"}]})]) {
    const chunks = await collect(body, {...sourceOptions, requireCompletedMessage: false});
    assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, "stop");
  }
});

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

test("gemini billed output includes thinking tokens", () => {
  assert.equal(
    geminiBilledOutputTokens({ candidatesTokenCount: 40, thoughtsTokenCount: 120 }),
    160
  );
  assert.equal(geminiBilledOutputTokens({ totalTokenCount: 200, promptTokenCount: 50 }), 150);
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
