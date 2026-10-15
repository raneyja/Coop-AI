import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiProviderClient, applyOpenAiThinking, parseOpenAiSseLine } from "./openaiClient";
import type { ParseState } from "./baseClient";
import type { ProviderStreamOptions, StreamChunk } from "../types";

const schema = {type: "object", additionalProperties: false, required: ["verdict"],
  properties: {verdict: {type: "string", enum: ["supported", "revise"]}}};
const reviewOptions: ProviderStreamOptions = {model: "gpt-5.5", messages: [{role: "user", content: "Review the evidence."}],
  temperature: 0.1, maxTokens: 32000, requestId: "fixture-review", responseSchema: schema,
  thinking: {mode: "openai-reasoning", effort: "high"}};
const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const delta = sse({choices: [{delta: {content: '{"verdict":"supported"}'}}], usage: {prompt_tokens: 32}});
const finished = sse({choices: [{delta: {}, finish_reason: "stop"}], usage: {prompt_tokens: 32, completion_tokens: 10}});

test("native review schema preserves reasoning, zero retention and the actual stream contract", async () => {
  for (const native of [true, false]) {
    const client = new OpenAiProviderClient("openai", {apiKey: "test-only", fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false); assert.equal(body.reasoning_effort, "high");
      assert.equal(body.temperature, undefined); assert.equal(body.max_completion_tokens, 32768);
      assert.deepEqual(body.response_format, native ? {type: "json_schema", json_schema: {
        name: "coop_source_claim_review", strict: true, schema}} : undefined);
      return new Response(delta + finished + "data: [DONE]");
    }});
    const chunks: StreamChunk[] = [];
    for await (const chunk of client.streamCompletion({...reviewOptions, responseSchema: native ? schema : undefined})) chunks.push(chunk);
    const done = chunks.find(chunk => chunk.type === "done");
    assert.equal(done?.finishReason, "stop", JSON.stringify(chunks)); assert.equal(done?.usage.inputTokens, 32);
    assert.equal(done?.usage.outputTokens, 10); assert(!chunks.some(chunk => chunk.type === "error"));
  }
});

test("structured review requires both a supported finish reason and terminal marker", async () => {
  for (const body of [delta, delta + finished, delta + "data: [DONE]",
    delta + sse({choices: [{delta: {}, finish_reason: "tool_calls"}]}) + "data: [DONE]",
    delta + finished + sse({error: {message: "overloaded", code: "overloaded"}}) + "data: [DONE]"]) {
    const client = new OpenAiProviderClient("openai", {apiKey: "test-only", fetchImpl: async () => new Response(body)});
    const chunks: StreamChunk[] = [];
    for await (const chunk of client.streamCompletion(reviewOptions)) chunks.push(chunk);
    assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, "error");
    assert(chunks.some(chunk => chunk.type === "error"));
  }
});

test("source-backed textual corrections require completion without requesting JSON output", async () => {
  const client = new OpenAiProviderClient("openai", {apiKey: "test-only", fetchImpl: async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).response_format, undefined);
    return new Response(delta + finished);
  }});
  const chunks: StreamChunk[] = [];
  for await (const chunk of client.streamCompletion({...reviewOptions, responseSchema: undefined,
    requireCompletedMessage: true})) chunks.push(chunk);
  assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, "error");
  assert(chunks.some(chunk => chunk.type === "error"));
});

test("structured review preserves length cutoffs, trailing UTF8 and known failure or Stop usage", async () => {
  const text = sse({choices: [{delta: {content: "☃"}}], usage: {prompt_tokens: 32}});
  const bytes = new TextEncoder().encode(text + sse({choices: [{delta: {}, finish_reason: "length"}],
    usage: {completion_tokens: 10}}) + "data: [DONE]");
  const chunks: StreamChunk[] = [];
  const client = new OpenAiProviderClient("openai", {apiKey: "test-only", fetchImpl: async () => new Response(new ReadableStream({
    start(stream) {const at = bytes.indexOf(0xe2); stream.enqueue(bytes.slice(0, at + 1)); stream.enqueue(bytes.slice(at + 1)); stream.close();}
  }))});
  for await (const chunk of client.streamCompletion(reviewOptions)) chunks.push(chunk);
  assert.equal(chunks.filter(chunk => chunk.type === "delta").map(chunk => chunk.text).join(""), "☃");
  assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, "length");
  for (const cancelled of [false, true]) {
    const controller = new AbortController(); let pulled = false;
    const interrupted = new OpenAiProviderClient("openai", {apiKey: "test-only", fetchImpl: async () => new Response(new ReadableStream({
      pull(stream) {if (!pulled) {pulled = true; stream.enqueue(new TextEncoder().encode(delta)); return;}
        if (cancelled) controller.abort(); stream.error(new Error("interrupted"));}
    }))});
    const result: StreamChunk[] = [];
    for await (const chunk of interrupted.streamCompletion({...reviewOptions, signal: controller.signal})) result.push(chunk);
    const done = result.find(chunk => chunk.type === "done");
    assert.equal(done?.finishReason, cancelled ? "cancelled" : "error"); assert.equal(done?.usage.inputTokens, 32);
    assert.equal(result.some(chunk => chunk.type === "error"), !cancelled);
  }
});

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
  const withThinking = applyOpenAiThinking(
    { model: "gpt-5.1", temperature: 0.5 },
    { mode: "openai-reasoning", effort: "medium" }
  );
  assert.equal(withThinking.reasoning_effort, "medium");
  assert.equal("temperature" in withThinking, false);
  assert.equal(
    "reasoning_effort" in applyOpenAiThinking({ model: "gpt-4o-mini" }, { mode: "adaptive" }),
    false
  );
});
