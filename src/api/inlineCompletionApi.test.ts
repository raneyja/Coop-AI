import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { ModelRouter } from "./ModelRouter";
import { handleInlineCompletionRequest } from "./inlineCompletionApi";

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
    { orgId: "org-test", plan: "pro" }
  );

  assert.equal(res.statusCode, 200, "inline completion should return 200");
  const payload = JSON.parse(res.body ?? "{}") as Record<string, unknown>;
  assert.equal(typeof payload.text, "string");
  console.log("inlineCompletionApi: 1/1 tests passed");
})();
