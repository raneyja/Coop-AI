import assert from "node:assert/strict";
import test from "node:test";
import { ModelRouter } from "./ModelRouter";
import type { CompletionRequest } from "./types";

test("Blast source bodies select the dedicated contract in the actual Anthropic request", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"verified"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\ndata: {"type":"message_stop"}\n\n', {
      headers: { "content-type": "text/event-stream" }
    });
  }) as typeof fetch;
  try {
    const router = new ModelRouter({ config: {
      defaultProvider: "anthropic", mockMode: false, allowUnapprovedProvider: true,
      apiKeys: { anthropic: "fixture-key" }
    } });
    const request: CompletionRequest = {
      requestId: "blast-source-fixture", orgId: "fixture", plan: "pro", history: [],
      message: "## Opened selected-ref source bodies\n<file_content path=\"src/handler.ts\">\nif (isSignatureField) {\n  await tx.signature.upsert({ create: {}, update: {} });\n}\n</file_content>",
      useCase: "blast_radius", allowUnapprovedProvider: true, enableThinking: true,
      modelConfig: { provider: "anthropic", model: "claude-sonnet-4-6", temperature: 0.5, maxTokens: 16000 }
    };
    for await (const chunk of router.stream(request)) assert.notEqual(chunk.type, "error");
    assert.equal(bodies.length, 1);
    const system = String(bodies[0].system);
    assert.match(system, /Required response policy — opened source/);
    assert.match(system, /Answer the user's actual request/);
    assert.match(system, /complete conditions, earlier exits, exception branches, and conditional operations/);
    assert.match(system, /Dependency relationships and import spelling/);
    assert.doesNotMatch(system, /\*\*Testing surfaces\*\*/);
    assert.doesNotMatch(system, /\*\*Top risk surfaces\*\*/);
    assert.equal(bodies[0].temperature, 1);
    assert.ok(bodies[0].thinking);
    const user = (bodies[0].messages as { content: unknown }[]).at(-1);
    assert.ok(JSON.stringify(user).includes("if (isSignatureField)"));

    for await (const chunk of router.stream({ ...request, message: "Graph-only Blast request" })) assert.notEqual(chunk.type, "error");
    assert.match(String(bodies[1].system), /\*\*Testing surfaces\*\*/);
    assert.doesNotMatch(String(bodies[1].system), /Required response policy — opened source/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
