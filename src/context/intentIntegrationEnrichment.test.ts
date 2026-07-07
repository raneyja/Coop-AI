import assert from "node:assert/strict";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";
import { enrichIntentFetchResultsOnce, pickIntegrationData } from "./intentIntegrationEnrichment";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function makeRequest(id: string): ContextFetchRequest {
  return {
    id,
    type: "file_metadata",
    params: { quickAction: "understand-repo" },
    intent: {
      id: "intent-1",
      intent: 7,
      context: {},
      timestamp: new Date(),
      costEstimate: "cheap"
    } as ContextFetchRequest["intent"],
    cost: "cheap",
    createdAt: new Date()
  };
}

function makeResult(id: string, data: Record<string, unknown>): ContextFetchResult {
  return {
    requestId: id,
    type: "file_metadata",
    data,
    fetchedAt: new Date()
  };
}

async function run(): Promise<void> {
  await test("enriches once and merges integration data into all results", async () => {
    const requests = [makeRequest("req-1"), makeRequest("req-2"), makeRequest("req-3")];
    const results = [
      makeResult("req-1", { marker: "a" }),
      makeResult("req-2", { marker: "b" }),
      makeResult("req-3", { marker: "c" })
    ];

    let enrichCalls = 0;
    const enriched = await enrichIntentFetchResultsOnce({
      requests,
      results,
      enrich: async (result) => {
        enrichCalls += 1;
        return {
          ...result,
          data: {
            ...(result.data as Record<string, unknown>),
            jiraSearch: { issues: [{ key: "COOP-101" }] },
            slackSearch: { messages: [{ text: "hello" }] }
          }
        };
      }
    });

    assert.equal(enrichCalls, 1);
    assert.deepEqual(
      (enriched[0].data as Record<string, unknown>).jiraSearch,
      (enriched[1].data as Record<string, unknown>).jiraSearch
    );
    assert.deepEqual(
      (enriched[1].data as Record<string, unknown>).slackSearch,
      (enriched[2].data as Record<string, unknown>).slackSearch
    );
    assert.equal((enriched[2].data as Record<string, unknown>).marker, "c");
  });

  await test("returns original results when primary request result is missing", async () => {
    const requests = [makeRequest("req-1")];
    const results = [makeResult("req-x", { marker: "x" })];
    let calls = 0;

    const enriched = await enrichIntentFetchResultsOnce({
      requests,
      results,
      enrich: async (result) => {
        calls += 1;
        return result;
      }
    });

    assert.equal(calls, 0);
    assert.equal(enriched, results);
  });

  await test("replaces primary result even when no integration keys are present", async () => {
    const requests = [makeRequest("req-1"), makeRequest("req-2")];
    const results = [makeResult("req-1", { marker: "a" }), makeResult("req-2", { marker: "b" })];

    const enriched = await enrichIntentFetchResultsOnce({
      requests,
      results,
      enrich: async (result) => ({
        ...result,
        data: {
          ...(result.data as Record<string, unknown>),
          marker: "updated"
        }
      })
    });

    assert.equal((enriched[0].data as Record<string, unknown>).marker, "updated");
    assert.equal((enriched[1].data as Record<string, unknown>).marker, "b");
  });

  await test("pickIntegrationData extracts only integration fields", () => {
    const extracted = pickIntegrationData({
      jiraSearch: { issues: [] },
      codeHostSearch: { pullRequests: [] },
      marker: "ignore"
    });
    assert.deepEqual(extracted, {
      jiraSearch: { issues: [] },
      codeHostSearch: { pullRequests: [] }
    });
  });

  const total = passed + failed;
  console.log(`\nintentIntegrationEnrichment: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
