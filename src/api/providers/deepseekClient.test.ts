import assert from "node:assert/strict";
import { DeepSeekProviderClient } from "./deepseekClient";
import type { StreamChunk } from "../types";

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
