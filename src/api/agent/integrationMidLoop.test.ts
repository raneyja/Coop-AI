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

  function huntAuthOrchestrator() {
    return createAgentOrchestrator({
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
  }

  const huntThenDone = async ({ round }: { round: number }) => {
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
  };

  const I3_ASK =
    "Where is requireAuth defined, and what did we already decide about peeling auth into coop-backend?";

    await test("after a matching hunt, Jira fill uses decision terms not the locate symbol", async () => {
    const calls: Array<{ query: string; openIds?: string[] }> = [];
    const orchestrator = huntAuthOrchestrator();
    const result = await orchestrator.run(
      {
        message: I3_ASK,
        repoId: "acme/demo",
        maxSteps: 6
      },
      {
        allowedIntegrations: ["jira"],
        fillIntegrations: ["jira"],
        fillQueries: { jira: "peel auth coop-backend" },
        searchIntegration: async ({ query, openIds }) => {
          calls.push({ query, openIds });
          const issue = { key: "COOP-101", summary: "Extract auth" };
          if (openIds?.length) {
            return { source: "jira-search", issues: [{ ...issue, opened: true, description: "Opened body." }] };
          }
          return { source: "jira-search", issues: [issue] };
        },
        planTurn: huntThenDone
      }
    );
    assert.equal(calls[0]?.query, "peel auth coop-backend");
    assert.equal(calls[0]?.openIds, undefined);
    assert.deepEqual(calls[1]?.openIds, ["COOP-101"]);
    assert.equal(
      calls.some((call) => /requireauth/i.test(call.query)),
      false
    );
    assert.ok(result.steps.some((s) => s.tool === "search_jira"));
    assert.match(
      result.steps.find((s) => s.summary.includes("peel auth coop-backend"))?.summary ?? "",
      /peel auth coop-backend/
    );
    assert.match(
      result.steps.find((s) => s.summary.includes("Open"))?.summary ?? "",
      /Open COOP-101/
    );
  });

  await test("after hunt+done, fill Jira Search with hits must Open; Body only after Open; empty Slack stays empty", async () => {
    const calls: Array<{ provider: string; openIds?: string[] }> = [];
    let openedEvidence: string | undefined;
    const jiraHits = [
      { key: "NOISE-1", summary: "Standup notes" },
      { key: "NOISE-2", summary: "Retro" },
      { key: "NOISE-3", summary: "Weekly" },
      {
        key: "COOP-101",
        summary: "Extract auth and repo indexing into coop-backend",
        status: "In Progress"
      }
    ];
    const orchestrator = huntAuthOrchestrator();
    await orchestrator.run(
      {
        message: I3_ASK,
        repoId: "acme/demo",
        maxSteps: 6
      },
      {
        allowedIntegrations: ["jira", "slack"],
        fillIntegrations: ["jira", "slack"],
        fillQueries: { jira: "peel auth coop-backend", slack: "peel auth coop-backend" },
        searchIntegration: async ({ provider, openIds }) => {
          calls.push({ provider, openIds });
          if (provider === "slack") {
            return { source: "slack-search", messages: [] };
          }
          if (openIds?.length) {
            return {
              source: "jira-search",
              issues: jiraHits.map((issue) =>
                openIds.includes(issue.key)
                  ? {
                      ...issue,
                      opened: true,
                      description: "Chose GitHub App over PAT for requireAuth."
                    }
                  : issue
              )
            };
          }
          return { source: "jira-search", issues: jiraHits };
        },
        planTurn: huntThenDone,
        streamAnswer: async (input) => {
          openedEvidence = input.openedEvidence;
          return "ok";
        }
      }
    );
    assert.equal(
      calls.some((call) => call.provider === "jira" && !call.openIds?.length),
      true
    );
    const jiraOpen = calls.find((call) => call.provider === "jira" && (call.openIds?.length ?? 0) > 0);
    assert.ok(jiraOpen?.openIds?.includes("COOP-101"));
    assert.equal(
      calls.some((call) => call.provider === "slack" && (call.openIds?.length ?? 0) > 0),
      false
    );
    assert.match(openedEvidence ?? "", /Body: Chose GitHub App/);
    assert.match(openedEvidence ?? "", /Slack: no matching messages/);
    assert.doesNotMatch(openedEvidence ?? "", /Standup notes/);
  });

  await test("fill Slack with zero messages does not Open", async () => {
    const openIdsCalls: string[][] = [];
    const orchestrator = huntAuthOrchestrator();
    await orchestrator.run(
      {
        message: I3_ASK,
        repoId: "acme/demo",
        maxSteps: 6
      },
      {
        allowedIntegrations: ["slack"],
        fillIntegrations: ["slack"],
        fillQueries: { slack: "peel auth coop-backend" },
        searchIntegration: async ({ openIds }) => {
          if (openIds?.length) {
            openIdsCalls.push([...openIds]);
          }
          return { source: "slack-search", messages: [] };
        },
        planTurn: huntThenDone
      }
    );
    assert.deepEqual(openIdsCalls, []);
  });

  await test("fill Opens named Notion title even when it is hit 4", async () => {
    const openIdsCalls: string[][] = [];
    const pages = [
      { id: "p1", title: "Standup notes" },
      { id: "p2", title: "Retro" },
      { id: "p3", title: "Weekly" },
      { id: "p4", title: "Architecture Overview" }
    ];
    const orchestrator = huntAuthOrchestrator();
    await orchestrator.run(
      {
        message: I3_ASK,
        repoId: "acme/demo",
        maxSteps: 6
      },
      {
        allowedIntegrations: ["notion"],
        fillIntegrations: ["notion"],
        fillQueries: { notion: "Architecture Overview" },
        searchIntegration: async ({ openIds }) => {
          if (openIds?.length) {
            openIdsCalls.push([...openIds]);
            return {
              pages: pages.map((page) =>
                openIds.includes(page.id)
                  ? { ...page, excerpt: "Extract auth into coop-backend.", opened: true }
                  : page
              )
            };
          }
          return { pages };
        },
        planTurn: huntThenDone,
        streamAnswer: async () => "ok"
      }
    );
    assert.deepEqual(openIdsCalls[0], ["p4"]);
  });

  await test("fill Opens named Confluence title even when it is hit 4", async () => {
    const openIdsCalls: string[][] = [];
    const pages = [
      { id: "c1", title: "Standup notes" },
      { id: "c2", title: "Retro" },
      { id: "c3", title: "Weekly" },
      { id: "1212417", title: "ADR: Backend service extraction (COOP-101)" }
    ];
    const orchestrator = huntAuthOrchestrator();
    await orchestrator.run(
      {
        message: I3_ASK,
        repoId: "acme/demo",
        maxSteps: 6
      },
      {
        allowedIntegrations: ["confluence"],
        fillIntegrations: ["confluence"],
        fillQueries: { confluence: "Backend service extraction" },
        searchIntegration: async ({ openIds }) => {
          if (openIds?.length) {
            openIdsCalls.push([...openIds]);
            return {
              pages: pages.map((page) =>
                openIds.includes(page.id)
                  ? {
                      ...page,
                      excerpt: "Extract GitHub pagination and repo indexing into coop-backend.",
                      opened: true
                    }
                  : page
              )
            };
          }
          return { pages };
        },
        planTurn: huntThenDone,
        streamAnswer: async () => "ok"
      }
    );
    assert.deepEqual(openIdsCalls[0], ["1212417"]);
  });

  console.log(`\nintegrationMidLoop: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
