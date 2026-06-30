import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { ModelRouter } from "./ModelRouter";
import { handleInlineCompletionRequest, defaultInlineModelFor } from "./inlineCompletionApi";
import { INLINE_MODEL_PRESETS } from "../config/inlineModelPresets";

function mockResponse(): ServerResponse & { statusCode?: number; body?: string } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    writeHead(code: number) {
      this.statusCode = code;
    },
    end(payload: string) {
      this.body = payload;
    }
  };
  return res as ServerResponse & { statusCode?: number; body?: string };
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

  console.log(`inlineCompletionApi: ${passed}/3 tests passed`);
})();
