#!/usr/bin/env node
/**
 * Autocomplete smoke test — running Coop API (Docker or deployed).
 *
 * Default: http://localhost:8787 with Bearer smoke-test (works when COOP_REQUIRE_API_AUTH=false).
 *
 * Env:
 *   COOP_API_BASE   — API root (default http://localhost:8787)
 *   COOP_API_KEY    — Bearer token (default smoke-test)
 *   COOP_SKIP_LLM   — set to 1 to only run health + validation steps (skip LLM calls)
 */
const API_BASE = (process.env.COOP_API_BASE ?? "http://localhost:8787").replace(/\/$/, "");
const API_KEY = process.env.COOP_API_KEY ?? "smoke-test";
const SKIP_LLM = process.env.COOP_SKIP_LLM === "1" || process.env.COOP_SKIP_LLM === "true";

let passed = 0;
let skipped = 0;

function authHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function step(label, fn) {
  process.stdout.write(`  ${label}… `);
  try {
    const result = await fn();
    if (result === "skip") {
      skipped += 1;
      console.log("SKIP");
      return;
    }
    passed += 1;
    console.log("OK");
  } catch (error) {
    console.log("FAIL");
    throw error;
  }
}

async function postInline(body, options = {}) {
  const res = await fetch(`${API_BASE}/v1/completions/inline`, {
    method: "POST",
    headers: authHeaders(options.headers),
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { res, data, text };
}

function assertOkResponse(label, res, data) {
  if (!res.ok) {
    const message = data.error ?? data.message ?? `HTTP ${res.status}`;
    throw new Error(`${label}: ${message}`);
  }
}

async function main() {
  console.log("\nCoop AI — autocomplete live smoke test\n");
  console.log(`  API: ${API_BASE}`);
  console.log(`  Auth: ${API_KEY ? "Bearer ***" : "none"}\n`);

  let health = null;

  await step("GET /health", async () => {
    const res = await fetch(`${API_BASE}/health`);
    health = await res.json();
    if (!res.ok || !health.ok) {
      throw new Error(`health ${res.status}`);
    }
    const llm = health.llm ?? {};
    console.log(
      `\n      mockMode=${llm.mockMode ?? "?"} providers=[${(llm.configuredProviders ?? []).join(", ")}]`
    );
    if (llm.mockMode) {
      console.log("      ⚠ mock mode — remove COOP_LLM_MOCK from .env.backend for real completions");
    }
    if (!llm.mockMode && (llm.configuredProviders ?? []).length === 0) {
      console.log("      ⚠ no LLM providers configured — add API keys to .env.backend");
    }
  });

  const canCallLlm =
    !SKIP_LLM &&
    (health?.llm?.mockMode === true || (health?.llm?.configuredProviders ?? []).length > 0);

  if (!canCallLlm) {
    console.log("\n  LLM inline steps skipped (COOP_SKIP_LLM or no providers/mock).\n");
    console.log(`Live smoke: ${passed} passed, ${skipped} skipped (health only).\n`);
    return;
  }

  await step("POST /v1/completions/inline (message)", async () => {
    const { res, data } = await postInline({
      message: "function greet() {\n  return '",
      languageId: "typescript",
      file: "src/example.ts",
      provider: "openai",
      model: "gpt-4o-mini"
    });
    assertOkResponse("inline message", res, data);
    if (typeof data.text !== "string") {
      throw new Error("missing text");
    }
    if (typeof data.latencyMs !== "number") {
      throw new Error("missing latencyMs");
    }
    if (typeof data.provider !== "string" || typeof data.model !== "string") {
      throw new Error("missing provider/model");
    }
  });

  await step("POST /v1/completions/inline (FIM segments)", async () => {
    const { res, data } = await postInline({
      segments: { prefix: "const value = ", suffix: ";" },
      languageId: "typescript",
      file: "src/example.ts",
      provider: "openai",
      model: "gpt-4o-mini"
    });
    assertOkResponse("inline FIM", res, data);
    if (typeof data.text !== "string") {
      throw new Error("missing text");
    }
    if (data.fim !== true && data.fim !== false) {
      throw new Error("missing fim flag");
    }
  });

  await step("POST /v1/completions/inline (SSE stream)", async () => {
    const res = await fetch(`${API_BASE}/v1/completions/inline`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        segments: { prefix: "obj.", suffix: "" },
        stream: true,
        languageId: "typescript",
        file: "src/example.ts",
        provider: "openai",
        model: "gpt-4o-mini"
      })
    });
    const body = await res.text();
    if (!res.ok) {
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        data = { raw: body };
      }
      assertOkResponse("inline stream", res, data);
    }
    if (!body.includes("data:")) {
      throw new Error("stream response missing SSE data lines");
    }
    if (!body.includes('"type":"delta"') && !body.includes('"type": "delta"')) {
      throw new Error("stream response missing delta events");
    }
  });

  await step("POST /v1/completions/inline (graph context degraded)", async () => {
    const { res, data } = await postInline(
      {
        message: "const value = ",
        useGraphContext: true,
        repoId: "github:smoke/missing-repo",
        file: "src/example.ts",
        languageId: "typescript",
        provider: "openai",
        model: "gpt-4o-mini"
      },
      { headers: {} }
    );
    assertOkResponse("inline graph", res, data);
    const graphHeader = res.headers.get("x-graph-context");
    if (graphHeader !== "degraded" && graphHeader !== null) {
      throw new Error(`unexpected x-graph-context: ${graphHeader}`);
    }
  });

  await step("POST /v1/usage/events (completion telemetry)", async () => {
    const res = await fetch(`${API_BASE}/v1/usage/events`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        events: [
          { eventType: "completion.suggested", metadata: { languageId: "typescript" } },
          { eventType: "completion.accepted", metadata: { languageId: "typescript" } },
          {
            eventType: "completion.performance",
            metadata: {
              requestCount: 5,
              acceptCount: 2,
              rejectCount: 1,
              p50LatencyMs: 280,
              p95LatencyMs: 520,
              lastLatencyMs: 240
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

  console.log(`\nAll live autocomplete smoke steps passed (${passed} OK, ${skipped} skipped).\n`);
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
