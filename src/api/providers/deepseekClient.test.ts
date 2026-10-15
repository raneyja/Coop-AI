import assert from "node:assert/strict";
import test from "node:test";
import { DeepSeekProviderClient } from "./deepseekClient";
import type { ProviderStreamOptions, StreamChunk } from "../types";

const sourceOptions: ProviderStreamOptions = {model: "deepseek-chat", messages: [{role: "user", content: "Explain source."}],
  temperature: 0.5, maxTokens: 8192, requestId: "source-fixture", requireCompletedMessage: true};
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const delta = event({choices: [{delta: {content: "☃"}}], usage: {prompt_tokens: 32, completion_tokens: 10}});
async function collect(body: string | ReadableStream<Uint8Array>, options = sourceOptions) {
  const client = new DeepSeekProviderClient("deepseek", {apiKey: "test-only", fetchImpl: async () => new Response(body)});
  const chunks: StreamChunk[] = [];
  for await (const chunk of client.streamCompletion(options)) chunks.push(chunk);
  return chunks;
}

test("source DeepSeek needs a supported finish plus DONE and handles UTF8/trailing sentinel", async () => {
  for (const reason of ["stop", "length"]) {
    const bytes = new TextEncoder().encode(delta + event({choices: [{delta: {}, finish_reason: reason}]}) + "data: [DONE]");
    const at = bytes.indexOf(0xe2) + 1;
    const chunks = await collect(new ReadableStream({start(stream) {stream.enqueue(bytes.slice(0, at)); stream.enqueue(bytes.slice(at)); stream.close();}}));
    assert.equal(chunks.filter(chunk => chunk.type === "delta").map(chunk => chunk.text).join(""), "☃");
    assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, reason);
    assert.equal(chunks.find(chunk => chunk.type === "done")?.usage.outputTokens, 10);
  }
});

test("source DeepSeek refuses missing completion and unsupported terminal reasons with known usage", async () => {
  for (const body of [delta, delta + event({choices: [{delta: {}, finish_reason: "stop"}]}), delta + "data: [DONE]",
    ...["tool_calls", "content_filter", "insufficient_system_resource", "aborted"].map(reason =>
      delta + event({choices: [{delta: {}, finish_reason: reason}]}) + "data: [DONE]")]) {
    const chunks = await collect(body);
    assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, "error");
    assert.equal(chunks.find(chunk => chunk.type === "done")?.usage.inputTokens, 32);
    assert(chunks.some(chunk => chunk.type === "error"));
  }
});

test("source DeepSeek errors and user Stop preserve known usage without successful completion", async () => {
  const errored = await collect(delta + event({error: {message: "overloaded"}}));
  assert.equal(errored.find(chunk => chunk.type === "done")?.finishReason, "error");
  assert.equal(errored.find(chunk => chunk.type === "done")?.usage.outputTokens, 10);
  for (const cancelled of [false, true]) {
    const controller = new AbortController(); let pulled = false;
    const body = new ReadableStream<Uint8Array>({pull(stream) {if (!pulled) {pulled = true; stream.enqueue(new TextEncoder().encode(delta));}
      else stream.error(new Error("interrupted"));}});
    const client = new DeepSeekProviderClient("deepseek", {apiKey: "test-only", fetchImpl: async () => new Response(body)});
    const chunks: StreamChunk[] = [];
    for await (const chunk of client.streamCompletion({...sourceOptions, signal: controller.signal})) {
      chunks.push(chunk); if (cancelled && chunk.type === "delta") controller.abort();
    }
    assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, cancelled ? "cancelled" : "error");
    assert.equal(chunks.find(chunk => chunk.type === "done")?.usage.inputTokens, 32);
  }
});

test("ordinary DeepSeek EOF contract is retained without strict source completion", async () => {
  const chunks = await collect(delta, {...sourceOptions, requireCompletedMessage: false});
  assert.equal(chunks.find(chunk => chunk.type === "done")?.finishReason, "stop");
});

// B5: DeepSeek streamFim must send the zero-retention header set, like the chat path and mistral FIM.
void (async () => {
  let capturedHeaders: Record<string, unknown> = {};
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    capturedHeaders = (init?.headers ?? {}) as Record<string, unknown>;
    return new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  }) as unknown as typeof fetch;

  const client = new DeepSeekProviderClient("deepseek", {
    apiKey: "sk-test",
    fetchImpl: fakeFetch
  });

  const chunks: StreamChunk[] = [];
  for await (const chunk of client.streamFim({
    prefix: "const x = ",
    suffix: ";",
    model: "deepseek-coder",
    temperature: 0.1,
    maxTokens: 32,
    requestId: "req-b5"
  })) {
    chunks.push(chunk);
  }

  assert.equal(capturedHeaders["x-data-retention-policy"], "none");
  assert.equal(capturedHeaders["x-no-training"], true);
  assert.equal(capturedHeaders["x-no-logging"], true);
  assert.equal(capturedHeaders["x-use-case"], "code-intelligence-inference");
  assert.equal(capturedHeaders["x-request-id"], "req-b5");
  assert.equal(capturedHeaders.authorization, "Bearer sk-test");

  console.log("deepseekClient.test.ts: ok");
})();
