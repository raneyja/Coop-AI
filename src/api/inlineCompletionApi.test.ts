import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { ModelRouter } from "./ModelRouter";
import {
  handleInlineCompletionRequest,
  defaultInlineModelFor,
  parseInlineBody
} from "./inlineCompletionApi";
import { INLINE_MODEL_PRESETS } from "../config/inlineModelPresets";

function mockResponse(): ServerResponse & { statusCode?: number; body?: string; chunks?: string[] } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    chunks: [] as string[],
    writeHead(code: number, _headers?: Record<string, string>) {
      this.statusCode = code;
    },
    write(payload: string) {
      this.chunks?.push(payload);
    },
    end(payload?: string) {
      if (payload !== undefined) {
        this.body = payload;
      } else if (this.chunks && this.chunks.length > 0) {
        this.body = this.chunks.join("");
      }
    }
  };
  return res as ServerResponse & { statusCode?: number; body?: string; chunks?: string[] };
}

void (async () => {
  process.env.COOP_LLM_MOCK = "true";

  const router = new ModelRouter({
    config: {
      defaultProvider: "anthropic",
      allowUnapprovedProvider: false,
      mockMode: true,
      apiKeys: {}
    }
  });

  const org = { orgId: "org-test", plan: "pro" as const };
  let passed = 0;

  const res = mockResponse();
  await handleInlineCompletionRequest(
    {
      message: "function hello() {\n  return '",
      languageId: "typescript",
      file: "src/example.ts"
    },
    res,
    router,
    router["config"],
    org
  );

  assert.equal(res.statusCode, 200, "inline completion should return 200");
  const payload = JSON.parse(res.body ?? "{}") as Record<string, unknown>;
  assert.equal(typeof payload.text, "string");
  assert.equal(typeof payload.model, "string");
  assert.equal(typeof payload.provider, "string");
  assert.equal(typeof payload.latencyMs, "number");
  assert.ok(Array.isArray(payload.alternatives));
  passed++;

  assert.equal(defaultInlineModelFor("anthropic"), INLINE_MODEL_PRESETS.haiku.model);
  assert.equal(defaultInlineModelFor("openai"), INLINE_MODEL_PRESETS.gpt35.model);
  passed++;

  const bad = mockResponse();
  await handleInlineCompletionRequest({ message: "   " }, bad, router, router["config"], org);
  assert.equal(bad.statusCode, 400);
  const badPayload = JSON.parse(bad.body ?? "{}") as Record<string, unknown>;
  assert.equal(badPayload.error, "invalid_request");
  passed++;

  const segmentsOnly = parseInlineBody({
    segments: { prefix: "const value = ", suffix: ";" }
  });
  assert.equal(segmentsOnly.ok, true);
  if (segmentsOnly.ok) {
    assert.equal(segmentsOnly.segments?.prefix, "const value = ");
    assert.equal(segmentsOnly.segments?.suffix, ";");
  }
  passed++;

  const longPrefix = parseInlineBody({
    segments: { prefix: "x".repeat(4001), suffix: "" }
  });
  assert.equal(longPrefix.ok, false);
  passed++;

  const longSuffix = parseInlineBody({
    segments: { prefix: "ok", suffix: "y".repeat(2001) }
  });
  assert.equal(longSuffix.ok, false);
  passed++;

  const fimRes = mockResponse();
  await handleInlineCompletionRequest(
    {
      segments: { prefix: "const x = ", suffix: ";" },
      languageId: "typescript"
    },
    fimRes,
    router,
    router["config"],
    org
  );
  assert.equal(fimRes.statusCode, 200);
  const fimPayload = JSON.parse(fimRes.body ?? "{}") as Record<string, unknown>;
  assert.equal(fimPayload.fim, true);
  assert.equal(typeof fimPayload.text, "string");
  passed++;

  const streamRes = mockResponse();
  await handleInlineCompletionRequest(
    {
      segments: { prefix: "obj.", suffix: "" },
      stream: true,
      languageId: "typescript"
    },
    streamRes,
    router,
    router["config"],
    org
  );
  assert.equal(streamRes.statusCode, 200);
  assert.ok(streamRes.body?.includes("data:"), "stream mode should emit SSE");
  assert.ok(streamRes.body?.includes('"type":"delta"'), "stream should include delta events");
  passed++;

  console.log(`inlineCompletionApi: ${passed}/${passed} tests passed`);
})();
