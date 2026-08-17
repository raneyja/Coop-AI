import assert from "node:assert/strict";
import { parseAgentToolPlan, buildAgentToolPlanPrompt } from "./parseAgentToolPlan";
import { handleIntegrationSearch } from "./tools/integrationSearch";
import { promoteAgentIntegrationSearches } from "./promoteAgentIntegrations";
import { createAgentOrchestrator } from "./AgentOrchestrator";
import type { IndexBackend } from "../../indexing/indexBackend";

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

async function main(): Promise<void> {
  await test("S-G8b search_jira invalid without allowlist", () => {
    assert.equal(
      parseAgentToolPlan(JSON.stringify({ tool: "search_jira", args: { query: "PROJ-1" } })).kind,
      "invalid"
    );
  });

  await test("S-G8b search_jira valid on allowlist", () => {
    const parsed = parseAgentToolPlan(
      JSON.stringify({ tool: "search_jira", args: { query: "PROJ-1" } }),
      { allowedIntegrations: ["jira", "slack"] }
    );
    assert.equal(parsed.kind, "call");
  });

  await test("S-G8b search_slack rejected when only jira allowlisted", () => {
    assert.equal(
      parseAgentToolPlan(JSON.stringify({ tool: "search_slack", args: { query: "auth" } }), {
        allowedIntegrations: ["jira"]
      }).kind,
      "invalid"
    );
  });

  await test("mid-loop jira tool calls searchIntegration with focused query", async () => {
    const calls: Array<{ provider: string; query: string }> = [];
    const raw = await handleIntegrationSearch(
      {
        indexBackend: {} as IndexBackend,
        resolveAbsolutePath: () => undefined,
        allowedIntegrations: ["jira"],
        searchIntegration: async ({ provider, query }) => {
          calls.push({ provider, query });
          return { source: "jira-search", issues: [{ key: query }] };
        }
      },
      "search_jira",
      { query: "AUTH-42" }
    );
    const parsed = JSON.parse(raw) as { issues?: Array<{ key: string }> };
    assert.deepEqual(calls, [{ provider: "jira", query: "AUTH-42" }]);
    assert.equal(parsed.issues?.[0]?.key, "AUTH-42");
  });

  await test("mid-loop blocks off-allowlist provider", async () => {
    const raw = await handleIntegrationSearch(
      {
        indexBackend: {} as IndexBackend,
        resolveAbsolutePath: () => undefined,
        allowedIntegrations: ["slack"],
        searchIntegration: async () => ({ messages: [] })
      },
      "search_jira",
      { query: "AUTH-42" }
    );
    assert.match(raw, /allowlist/i);
  });

  await test("orchestrator can call allowlisted jira mid-loop", async () => {
    const calls: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: {
        async search() {
          return { hits: [], symbols: [] };
        }
      } as unknown as IndexBackend,
      resolveAbsolutePath: () => undefined
    });
    const result = await orchestrator.run(
      { message: "Where is requireAuth and check Jira?", repoId: "acme/demo", maxSteps: 4 },
      {
        allowedIntegrations: ["jira"],
        searchIntegration: async ({ query }) => {
          calls.push(query);
          return { source: "jira-search", issues: [{ key: query, summary: "Auth" }] };
        },
        planTurn: async ({ round }) => {
          if (round === 0) {
            return JSON.stringify({ tool: "search_jira", args: { query: "AUTH-9" } });
          }
          return JSON.stringify({ done: true });
        }
      }
    );
    assert.deepEqual(calls, ["AUTH-9"]);
    assert.equal(result.context?.search_jira?.source, "jira-search");
    assert.ok(result.steps.some((s) => s.tool === "search_jira"));
  });

  await test("promoteAgentIntegrationSearches writes jiraSearch for synthesis", () => {
    const promoted = promoteAgentIntegrationSearches({
      requestId: "1",
      type: "chat_context",
      fetchedAt: new Date(),
      data: {
        agentTools: {
          search_jira: { source: "jira-search", issues: [{ key: "AUTH-9" }] }
        }
      }
    });
    const data = promoted.data as { jiraSearch?: { issues?: Array<{ key: string }> } };
    assert.equal(data.jiraSearch?.issues?.[0]?.key, "AUTH-9");
  });

  await test("prompt lists allowlisted integration tools", () => {
    const prompt = buildAgentToolPlanPrompt({
      message: "find auth and check jira",
      repoId: "acme/demo",
      round: 0,
      priorSummaries: [],
      allowedIntegrations: ["jira"]
    });
    assert.match(prompt, /search_jira/);
    assert.doesNotMatch(prompt, /search_slack/);
  });

  console.log(`\nintegrationMidLoop: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
