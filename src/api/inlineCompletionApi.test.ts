import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import { ModelRouter } from "./ModelRouter";
import {
  handleInlineCompletionRequest,
  defaultInlineModelFor,
  parseInlineBody
} from "./inlineCompletionApi";
import { INLINE_MODEL_PRESETS } from "../config/inlineModelPresets";
import { GraphQueryApi } from "./graphQuery";
import { GraphCache } from "../cache/graphCache";

function mockResponse(): ServerResponse & {
  statusCode?: number;
  body?: string;
  chunks?: string[];
  headers?: Record<string, string>;
} {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as string | undefined,
    chunks: [] as string[],
    headers: undefined as Record<string, string> | undefined,
    writeHead(code: number, headers?: Record<string, string>) {
      this.statusCode = code;
      this.headers = headers;
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
  return res as unknown as ServerResponse & { statusCode?: number; body?: string; chunks?: string[] };
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

  const multiLineRes = mockResponse();
  await handleInlineCompletionRequest(
    {
      message: "function foo() {\n  ",
      maxTokens: 200,
      languageId: "typescript"
    },
    multiLineRes,
    router,
    router["config"],
    org
  );
  assert.equal(multiLineRes.statusCode, 200);
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

  const graphCache = new GraphCache();
  graphCache.upsertRepository(
    { repoId: "github:acme/app", provider: "github", owner: "acme", repo: "app" },
    {
      fileTree: [
        { path: "src/example.ts", size: 10, lastModified: new Date(), lastAuthor: "dev", sha: "abc" }
      ],
      dependencies: [{ from: "src/user.ts", to: "src/example.ts", type: "import" }],
      owners: [
        {
          file: "src/example.ts",
          primaryOwner: "@alice",
          secondaryOwners: [],
          ownershipScore: 0.9
        }
      ]
    }
  );
  const graphQuery = new GraphQueryApi({ cache: graphCache });

  const graphRes = mockResponse();
  await handleInlineCompletionRequest(
    {
      message: "const value = ",
      useGraphContext: true,
      repoId: "github:acme/app",
      file: "src/example.ts",
      languageId: "typescript"
    },
    graphRes,
    router,
    router["config"],
    org,
    undefined,
    { graphQuery }
  );
  assert.equal(graphRes.statusCode, 200);
  assert.equal(graphRes.headers?.["x-graph-context"], undefined, "indexed graph should not degrade");
  passed++;

  const degradedRes = mockResponse();
  await handleInlineCompletionRequest(
    {
      message: "const value = ",
      useGraphContext: true,
      repoId: "github:acme/missing",
      file: "src/example.ts",
      languageId: "typescript"
    },
    degradedRes,
    router,
    router["config"],
    org,
    undefined,
    { graphQuery: new GraphQueryApi({ cache: new GraphCache() }) }
  );
  assert.equal(degradedRes.statusCode, 200);
  assert.equal(degradedRes.headers?.["x-graph-context"], "degraded");
  passed++;

  const freeRes = mockResponse();
  await handleInlineCompletionRequest(
    {
      message: "const value = ",
      useGraphContext: true,
      repoId: "github:acme/app",
      file: "src/example.ts",
      languageId: "typescript"
    },
    freeRes,
    router,
    router["config"],
    { orgId: "org-free", plan: "free" },
    undefined,
    { graphQuery }
  );
  assert.equal(freeRes.statusCode, 200);
  assert.equal(freeRes.headers?.["x-graph-context"], undefined, "free plan should use indexed graph when available");
  passed++;

  console.log(`inlineCompletionApi: ${passed}/${passed} tests passed`);
})();
