#!/usr/bin/env node
/**
 * Autocomplete smoke test — ephemeral API with mock LLM:
 * health → inline completion → usage events roundtrip.
 */
import { createServer } from "node:http";
import { URL } from "node:url";

process.env.COOP_LLM_MOCK = "true";
process.env.COOP_REQUIRE_API_AUTH = "false";
process.env.NODE_ENV = "development";

const { createChatRouter, handleChatApiRequest, llmHealthPayload } = await import(
  "../src/api/chatApi.ts"
);
const { handleUsageEventsApiRequest } = await import("../src/server/usageEventsApi.ts");
const { loadServerConfig } = await import("../src/server/serverConfig.ts");
const { UsageTracker } = await import("../src/server/usageTracker.ts");

const PORT = Number(process.env.AUTOCOMPLETE_SMOKE_PORT ?? 18787);
const router = createChatRouter();
const serverConfig = loadServerConfig();
const usageTracker = new UsageTracker(null);

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

async function parseRequest(request) {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const headers = {};
  for (const [key, value] of Object.entries(request.headers)) {
    headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return {
    method: request.method ?? "GET",
    pathname: url.pathname,
    query: url.searchParams,
    headers,
    body: await parseBody(request)
  };
}

const server = createServer(async (request, response) => {
  try {
    const parsed = await parseRequest(request);

    if (parsed.method === "GET" && parsed.pathname === "/health") {
      writeJson(response, 200, {
        ok: true,
        llm: llmHealthPayload(router)
      });
      return;
    }

    if (
      await handleChatApiRequest(
        {
          method: parsed.method,
          pathname: parsed.pathname,
          headers: parsed.headers,
          body: parsed.body
        },
        response,
        { router, serverConfig, usageTracker },
        request
      )
    ) {
      return;
    }

    if (
      await handleUsageEventsApiRequest(
        {
          method: parsed.method,
          pathname: parsed.pathname,
          headers: parsed.headers,
          body: parsed.body
        },
        response,
        { serverConfig, usageTracker }
      )
    ) {
      return;
    }

    writeJson(response, 404, { error: "not_found" });
  } catch (error) {
    writeJson(response, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

async function step(label, fn) {
  process.stdout.write(`  ${label}… `);
  await fn();
  console.log("OK");
}

async function main() {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });

  const base = `http://127.0.0.1:${PORT}`;
  console.log("\nCoop AI — autocomplete smoke test\n");

  try {
    await step("GET /health", async () => {
      const res = await fetch(`${base}/health`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(`health ${res.status}`);
      }
      if (!data.llm?.mockMode) {
        throw new Error("expected COOP_LLM_MOCK health payload");
      }
    });

    await step("POST /v1/completions/inline (mock)", async () => {
      const res = await fetch(`${base}/v1/completions/inline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "function greet() {\n  return '",
          languageId: "typescript",
          file: "src/example.ts"
        })
      });
      const data = await res.json();
      if (!res.ok || typeof data.text !== "string") {
        throw new Error(data.error ?? data.message ?? `inline ${res.status}`);
      }
      if (typeof data.latencyMs !== "number") {
        throw new Error("missing latencyMs");
      }
    });

    await step("POST /v1/completions/inline FIM segments (mock)", async () => {
      const res = await fetch(`${base}/v1/completions/inline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: { prefix: "const value = ", suffix: ";" },
          languageId: "typescript",
          file: "src/example.ts"
        })
      });
      const data = await res.json();
      if (!res.ok || typeof data.text !== "string") {
        throw new Error(data.error ?? data.message ?? `inline fim ${res.status}`);
      }
      if (data.fim !== true) {
        throw new Error("expected fim=true in mock response");
      }
    });

    await step("POST /v1/completions/inline SSE stream (mock)", async () => {
      const res = await fetch(`${base}/v1/completions/inline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: { prefix: "obj.", suffix: "" },
          stream: true,
          languageId: "typescript",
          file: "src/example.ts"
        })
      });
      const body = await res.text();
      if (!res.ok) {
        throw new Error(`inline stream ${res.status}`);
      }
      if (!body.includes("data:")) {
        throw new Error("stream missing SSE data lines");
      }
      if (!body.includes('"type":"delta"')) {
        throw new Error("stream missing delta events");
      }
    });

    await step("POST /v1/usage/events (completion roundtrip)", async () => {
      const res = await fetch(`${base}/v1/usage/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer smoke-test"
        },
        body: JSON.stringify({
          events: [
            { eventType: "completion.suggested", metadata: { languageId: "typescript" } },
            { eventType: "completion.accepted", metadata: { languageId: "typescript" } },
            {
              eventType: "completion.performance",
              metadata: {
                requestCount: 10,
                acceptCount: 3,
                rejectCount: 2,
                p50LatencyMs: 320,
                p95LatencyMs: 610,
                lastLatencyMs: 280
              }
            }
          ]
        })
      });
      const data = await res.json();
      if (!res.ok || data.recorded !== 3) {
        throw new Error(data.error ?? `usage ${res.status}`);
      }
    });

    console.log("\nAll autocomplete smoke steps passed.\n");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.log("FAIL");
  console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
