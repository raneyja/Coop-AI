import assert from "node:assert/strict";
import { parseAgentToolPlan, buildAgentToolPlanPrompt, buildAgentAnswerPrompt } from "./parseAgentToolPlan";
import { createAgentOrchestrator } from "./AgentOrchestrator";
import type { IndexBackend } from "../../indexing/indexBackend";
import { parseOpenIds, vendorSearchNeedsRetry, customerFacingVendorToolError } from "./vendorLoop";
import { rewriteCustomerFacingProse } from "../../chat/customerFacingAnswer";
import { agentTurnAction, agentTurnAllowsRepoTools, shouldRunAgentToolLoop } from "../../chat/agentRouting";
import { planChatIntentFromRules } from "../../chat/intentPlanner/planChatIntent";
import { integrationProvidersFromAgentSteps } from "./integrationTools";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

function emptyIndex(): IndexBackend {
  return {
    async search() {
      return { hits: [], symbols: [] };
    }
  } as unknown as IndexBackend;
}

async function main(): Promise<void> {
  await test("Choose Open: Search returns the full list; Open only chosen ids including hit 4", async () => {
    const calls: Array<{ query?: string; openIds?: string[] }> = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: emptyIndex(),
      resolveAbsolutePath: () => undefined
    });
    const pages = [
      { id: "p1", title: "Standup notes" },
      { id: "p2", title: "Retro" },
      { id: "p3", title: "Weekly" },
      { id: "p4", title: "Architecture Overview" }
    ];
    await orchestrator.run(
      {
        message: "Look in Notion — what does the Architecture Overview say about extracting auth?",
        repoId: "acme/demo",
        maxSteps: 6,
        action: "understand"
      },
      {
        allowedRepoTools: false,
        allowedIntegrations: ["notion"],
        searchIntegration: async ({ query, openIds }) => {
          calls.push({ query, openIds });
          if (openIds?.length) {
            return {
              pages: pages.map((page) =>
                openIds.includes(page.id)
                  ? { ...page, excerpt: "Extract auth into coop-backend." }
                  : page
              )
            };
          }
          return { pages };
        },
        planTurn: async ({ round }) => {
          if (round === 0) {
            return JSON.stringify({ tool: "search_notion", args: { query: "Architecture Overview" } });
          }
          if (round === 1) {
            return JSON.stringify({ tool: "search_notion", args: { ids: ["p4"] } });
          }
          return JSON.stringify({ done: true });
        }
      }
    );
    assert.equal(calls[0]?.query, "Architecture Overview");
    assert.equal(calls[0]?.openIds, undefined);
    assert.deepEqual(calls[1]?.openIds, ["p4"]);
  });

  await test("empty Search retries once then honest empty; no Open of junk", async () => {
    const calls: Array<{ query?: string; openIds?: string[] }> = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: emptyIndex(),
      resolveAbsolutePath: () => undefined
    });
    await orchestrator.run(
      { message: "Look in Notion for Architecture Overview", repoId: "acme/demo", maxSteps: 6, action: "understand" },
      {
        allowedRepoTools: false,
        allowedIntegrations: ["notion"],
        searchIntegration: async ({ query, openIds }) => {
          calls.push({ query, openIds });
          return { pages: [] };
        },
        planTurn: async ({ round }) => {
          if (round < 2) {
            return JSON.stringify({
              tool: "search_notion",
              args: { query: round === 0 ? "Architecture Overview" : "Architecture Overview page" }
            });
          }
          return JSON.stringify({ done: true });
        }
      }
    );
    assert.equal(calls.length, 2);
    assert.equal(calls.every((call) => !call.openIds?.length), true);
  });

  await test("named Notion-only rejects search_code; compound locate+Notion allows it", () => {
    assert.equal(
      parseAgentToolPlan(JSON.stringify({ tool: "search_code", args: { query: "requireAuth" } }), {
        allowedRepoTools: false,
        allowedIntegrations: ["notion"]
      }).kind,
      "invalid"
    );
    assert.equal(
      parseAgentToolPlan(JSON.stringify({ tool: "search_code", args: { query: "requireAuth" } }), {
        allowedRepoTools: true,
        allowedIntegrations: ["notion"]
      }).kind,
      "call"
    );
    const prompt = buildAgentToolPlanPrompt({
      message: "Look in Notion",
      repoId: "acme/demo",
      round: 0,
      priorSummaries: [],
      allowedIntegrations: ["notion"],
      allowedRepoTools: false
    });
    assert.doesNotMatch(prompt, /Allowed tools:.*search_code/);
    assert.match(prompt, /Repo hunt tools are off/);
    assert.match(prompt, /args.ids/);
  });

  await test("A-P9 / A-G7 named Slack loops without a repo hunt", () => {
    const query = "What's in Slack about this?";
    const plan = planChatIntentFromRules({ message: query, connectedTools: ["slack", "jira"] });
    assert.equal(shouldRunAgentToolLoop({ query, hasQuickAction: false, intentPlan: plan }), true);
    assert.equal(agentTurnAllowsRepoTools({ intentPlan: plan }), false);
    assert.equal(agentTurnAction({ query, hasQuickAction: false, intentPlan: plan }), "understand");
  });

  await test("slash runs the vendor loop without repo tools", () => {
    const query = "Architecture Overview";
    assert.equal(
      shouldRunAgentToolLoop({ query, hasQuickAction: false, integrationSlash: true }),
      true
    );
    assert.equal(agentTurnAllowsRepoTools({ integrationSlash: true }), false);
  });

  await test("Talk track rewriter strips timeout jargon", () => {
    const out = rewriteCustomerFacingProse("Timed out searching Notion for coop backend.");
    assert.match(out, /No mention in Notion of coop backend/i);
    assert.doesNotMatch(out, /timed out/i);
    assert.equal(
      customerFacingVendorToolError("Request timed out after 5 seconds", "notion"),
      "That search didn't finish."
    );
    assert.equal(customerFacingVendorToolError("Notion integration token not configured.", "notion"), "That tool isn't connected.");
    assert.equal(customerFacingVendorToolError("401 unauthorized", "notion"), "Couldn't sign in to that tool.");
  });

  await test("Talk track prompt has no intern-speak decision essays", () => {
    const prompt = buildAgentAnswerPrompt({ message: "Look in Notion" });
    assert.match(prompt, /one talk track/i);
    assert.doesNotMatch(prompt, /never conclude the team never decided/i);
    assert.match(prompt, /No mention in \{vendor\} of \{topic\}/);
  });

  await test("parseOpenIds caps at 3", () => {
    assert.deepEqual(parseOpenIds({ ids: ["a", "b", "c", "d"] }), ["a", "b", "c"]);
  });

  await test("empty Search needs retry", () => {
    assert.equal(vendorSearchNeedsRetry({ payload: { pages: [] }, query: "Architecture Overview", searches: 1 }), true);
    assert.equal(vendorSearchNeedsRetry({ payload: { pages: [] }, query: "Architecture Overview", searches: 2 }), false);
  });

  await test("2–3 chosen Opens run together; Interpret sees opened bodies", async () => {
    const openCalls: string[][] = [];
    const interpreted: string[] = [];
    const orchestrator = createAgentOrchestrator({
      indexBackend: emptyIndex(),
      resolveAbsolutePath: () => undefined
    });
    const pages = [
      { id: "p1", title: "Standup" },
      { id: "p2", title: "Retro" },
      { id: "p4", title: "Architecture Overview" }
    ];
    await orchestrator.run(
      { message: "Look in Notion", repoId: "acme/demo", maxSteps: 6, action: "understand" },
      {
        allowedRepoTools: false,
        allowedIntegrations: ["notion"],
        searchIntegration: async ({ openIds }) => {
          if (openIds?.length) {
            openCalls.push([...openIds]);
            return {
              pages: pages.map((page) =>
                openIds.includes(page.id) ? { ...page, excerpt: `body-${page.id}`, opened: true } : page
              )
            };
          }
          return { pages };
        },
        interpretOpens: async (artifacts) => {
          interpreted.push(...artifacts.map((artifact) => artifact.title));
          return artifacts.map((artifact) => `${artifact.title}: note`).join("\n");
        },
        planTurn: async ({ round }) => {
          if (round === 0) {
            return JSON.stringify({ tool: "search_notion", args: { query: "Architecture Overview" } });
          }
          if (round === 1) {
            return JSON.stringify({ tool: "search_notion", args: { ids: ["p4", "p2"] } });
          }
          return JSON.stringify({ done: true });
        },
        streamAnswer: async () => "Architecture Overview extracts auth."
      }
    );
    assert.deepEqual(openCalls[0], ["p4", "p2"]);
    assert.ok(interpreted.includes("Architecture Overview"));
    assert.equal(interpreted.includes("Standup"), false);
  });

  await test("compound locate + Notion allows search_code; Sources only the called vendor", () => {
    const query = "Where is requireAuth, and look in Notion?";
    const plan = planChatIntentFromRules({
      message: query,
      connectedTools: ["notion", "jira", "slack"]
    });
    assert.equal(plan.tools.includes("notion"), true);
    assert.equal(plan.tools.includes("jira"), false);
    assert.equal(agentTurnAllowsRepoTools({ intentPlan: plan }), true);
    assert.deepEqual(
      integrationProvidersFromAgentSteps([{ tool: "search_notion" }]),
      ["notion"]
    );
  });

  await test("not-connected / 401 / allowlist are not empty-Search copy", () => {
    assert.equal(customerFacingVendorToolError("Notion integration token not configured.", "notion"), "That tool isn't connected.");
    assert.equal(customerFacingVendorToolError("401 unauthorized", "jira"), "Couldn't sign in to that tool.");
    assert.equal(
      customerFacingVendorToolError("Notion scope is not configured. Your organization admin must select pages.", "notion"),
      "Nothing in the allowed Notion matched."
    );
    assert.doesNotMatch(
      customerFacingVendorToolError("Notion integration token not configured.", "notion"),
      /No mention in Notion/
    );
  });
}

void main().then(() => {
  console.log(`\nvendorLoop: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
});
