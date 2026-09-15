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

  await test("prompt lists connected integration tools", () => {
    const prompt = buildAgentToolPlanPrompt({
      message: "find auth and check jira",
      repoId: "acme/demo",
      round: 0,
      priorSummaries: [],
      allowedIntegrations: ["jira"],
      suggestedJobs: [{ capability: "locate", terms: ["requireAuth"] }]
    });
    assert.match(prompt, /Connected integration tools this turn: search_jira/);
    assert.doesNotMatch(prompt, /Connected integration tools this turn:.*search_slack/);
    assert.doesNotMatch(prompt, /Hunt the repo first/);
    assert.doesNotMatch(prompt, /none are on the allowlist/);
    assert.match(prompt, /Suggested queries, not a limit/);
    assert.match(prompt, /after a matching code read/);
    assert.match(prompt, /Never search those tools for the locate symbol/);
    assert.match(prompt, /search_code: prefer an exact symbol/);
    assert.doesNotMatch(prompt, /^Prefer an exact symbol name/m);
  });

  await test("connected vendor is callable even when planner tools would be empty", () => {
    const parsed = parseAgentToolPlan(
      JSON.stringify({ tool: "search_confluence", args: { query: "onboarding" } }),
      { allowedIntegrations: ["confluence"] }
    );
    assert.equal(parsed.kind, "call");
  });

  await test("does not backfill every connected vendor when fill hints are empty", async () => {
    const calls: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: {
        async search() {
          return { hits: [], symbols: [] };
        }
      } as unknown as IndexBackend,
      resolveAbsolutePath: () => undefined
    });
    await orchestrator.run(
      { message: "Where is requireAuth defined?", repoId: "acme/demo", maxSteps: 3 },
      {
        allowedIntegrations: ["jira", "slack", "confluence"],
        searchIntegration: async ({ provider }) => {
          calls.push(provider);
          return {};
        },
        planTurn: async ({ round }) => {
          if (round === 0) {
            return JSON.stringify({ done: true });
          }
          return JSON.stringify({ done: true });
        }
      }
    );
    assert.deepEqual(calls, []);
  });

    await test("after a matching hunt, Jira fill uses decision terms not the locate symbol", async () => {
    const calls: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: {
        async search() {
          return {
            hits: [
              {
                fileName: "src/auth/middleware.ts",
                lineNumber: 12,
                content: "export function requireAuth() {}",
                score: 1
              }
            ],
            symbols: []
          };
        }
      } as unknown as IndexBackend,
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path }) => ({
        path,
        content: "export function requireAuth() {\n  return true;\n}\n"
      })
    });
    const result = await orchestrator.run(
      {
        message: "Where is requireAuth defined, and what did we already decide about peeling auth into coop-backend?",
        repoId: "acme/demo",
        maxSteps: 6
      },
      {
        allowedIntegrations: ["jira"],
        fillIntegrations: ["jira"],
        fillQueries: { jira: "peel auth coop-backend" },
        searchIntegration: async ({ query }) => {
          calls.push(query);
          return { source: "jira-search", issues: [{ key: "COOP-101", summary: "Extract auth" }] };
        },
        planTurn: async ({ round }) => {
          if (round === 0) {
            return JSON.stringify({ tool: "search_code", args: { query: "requireAuth" } });
          }
          if (round === 1) {
            return JSON.stringify({
              tool: "read_file",
              args: { path: "src/auth/middleware.ts" }
            });
          }
          return JSON.stringify({ done: true });
        }
      }
    );
    assert.deepEqual(calls, ["peel auth coop-backend"]);
    assert.equal(
      calls.some((q) => /requireauth/i.test(q)),
      false
    );
    assert.ok(result.steps.some((s) => s.tool === "search_jira"));
    assert.match(
      result.steps.find((s) => s.tool === "search_jira")?.summary ?? "",
      /peel auth coop-backend/
    );
  });

  await test("I3 writer prompt receives opened Jira body, not title-only JSON", async () => {
    let openedEvidence: string | undefined;
    const orchestrator = createAgentOrchestrator({
      indexBackend: {
        async search() {
          return {
            hits: [
              {
                fileName: "src/auth/middleware.ts",
                lineNumber: 12,
                content: "export function requireAuth() {}",
                score: 1
              }
            ],
            symbols: []
          };
        }
      } as unknown as IndexBackend,
      resolveAbsolutePath: () => undefined,
      readRemoteFile: async ({ path }) => ({
        path,
        content: "export function requireAuth() {\n  return true;\n}\n"
      })
    });
    await orchestrator.run(
      {
        message:
          "Where is requireAuth defined, and what did we already decide about peeling auth into coop-backend?",
        repoId: "acme/demo",
        maxSteps: 6
      },
      {
        allowedIntegrations: ["jira", "slack"],
        fillIntegrations: ["jira", "slack"],
        fillQueries: { jira: "peel auth coop-backend", slack: "peel auth coop-backend" },
        searchIntegration: async ({ provider }) => {
          if (provider === "slack") {
            return { source: "slack-search", messages: [] };
          }
          return {
            source: "jira-search",
            issues: [
              {
                key: "COOP-101",
                summary: "Extract auth and repo indexing into coop-backend",
                status: "In Progress",
                description: "Chose GitHub App over PAT for requireAuth."
              }
            ]
          };
        },
        planTurn: async ({ round }) => {
          if (round === 0) {
            return JSON.stringify({ tool: "search_code", args: { query: "requireAuth" } });
          }
          if (round === 1) {
            return JSON.stringify({
              tool: "read_file",
              args: { path: "src/auth/middleware.ts" }
            });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async (input) => {
          openedEvidence = input.openedEvidence;
          return "ok";
        }
      }
    );
    assert.match(openedEvidence ?? "", /Body: Chose GitHub App/);
    assert.match(openedEvidence ?? "", /Slack: no matching messages/);
  });

  console.log(`\nintegrationMidLoop: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
