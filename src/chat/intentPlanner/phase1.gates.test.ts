import assert from "node:assert/strict";
import test from "node:test";
import type { ContextFetchRequest } from "../../context/requestBatcher";
import { requestAllowsIntegrationFetch } from "../../context/fetchIntegrationsAllowlist";
import { shouldFetchConfluenceContext } from "../../context/confluenceContext";
import { shouldFetchGoogleDocsContext } from "../../context/googleDocsContext";
import { shouldFetchJiraContext } from "../../context/jiraContext";
import { shouldFetchNotionContext } from "../../context/notionContext";
import { shouldFetchSlackContext } from "../../context/slackContext";
import { shouldFetchTeamsContext } from "../../context/teamsContext";
import { buildMultiToolPlainChatUserPrompt } from "../../prompts/multiToolPlainChatSynthesis";
import { planChatIntentFromRules } from "./planChatIntent";
import {
  assertAllGatesPass,
  gateFail,
  gatePass,
  PHASE1_GATE_CRITERIA,
  type GateResult
} from "./gates";

type Phase1Criterion = (typeof PHASE1_GATE_CRITERIA)[number];

function evaluateGate(criterion: Phase1Criterion, assertion: () => void): GateResult {
  try {
    assertion();
    return gatePass(1, criterion.id, criterion.title);
  } catch (error) {
    return gateFail(
      1,
      criterion.id,
      criterion.title,
      error instanceof Error ? error.message : String(error)
    );
  }
}

function plannedRequest(fetchIntegrations: ContextFetchRequest["params"]["fetchIntegrations"]): ContextFetchRequest {
  return {
    id: "phase1-gate",
    type: "chat_context",
    params: { fetchIntegrations },
    intent: {
      id: "phase1-gate-intent",
      intent: "manual_chat_submit",
      timestamp: new Date(0),
      context: { queryText: "Explain this code" },
      costEstimate: "expensive"
    },
    cost: "expensive",
    createdAt: new Date(0)
  } as ContextFetchRequest;
}

test("Phase 1 Chat Intent Planner gates", () => {
  const results: GateResult[] = [
    evaluateGate(PHASE1_GATE_CRITERIA[0], () => {
      const plan = planChatIntentFromRules({
        message: "Check Jira and Slack for context on this change",
        connectedTools: ["jira", "slack"]
      });
      assert.deepEqual(plan.tools, ["jira", "slack"]);
      const slackOnly = planChatIntentFromRules({
        message: "search slack for discussions about this file",
        activeFile: "src/workspace/IndexedRepoWorkspace.ts",
        connectedTools: ["slack", "teams", "jira"]
      });
      assert.deepEqual(slackOnly.tools, ["slack"]);
      assert.equal(slackOnly.mode, "tools-only");
    }),
    evaluateGate(PHASE1_GATE_CRITERIA[1], () => {
      for (const message of [
        "Explain this function",
        "summarize this file",
        "walk me through this function",
        "What does this file do?"
      ]) {
        const plan = planChatIntentFromRules({
          message,
          activeFile: "src/example.ts",
          connectedTools: ["jira", "slack", "confluence"]
        });
        assert.deepEqual(plan.tools, [], message);
        assert.equal(plan.mode, "plain", message);
      }
    }),
    evaluateGate(PHASE1_GATE_CRITERIA[2], () => {
      const plan = planChatIntentFromRules({
        message: "Check Jira for the related ticket",
        connectedTools: ["slack"]
      });
      // Named tools stay on the plan so we attempt the call / surface not-connected.
      assert.deepEqual(plan.tools, ["jira"]);
    }),
    evaluateGate(PHASE1_GATE_CRITERIA[3], () => {
      const request = plannedRequest([
        "jira",
        "slack",
        "teams",
        "confluence",
        "notion",
        "google-docs"
      ]);
      assert.equal(requestAllowsIntegrationFetch(request, "jira"), true);
      assert.equal(shouldFetchJiraContext(request), true);
      assert.equal(shouldFetchSlackContext(request), true);
      assert.equal(shouldFetchTeamsContext(request), true);
      assert.equal(shouldFetchConfluenceContext(request), true);
      assert.equal(shouldFetchNotionContext(request), true);
      assert.equal(shouldFetchGoogleDocsContext(request), true);
      assert.equal(requestAllowsIntegrationFetch(plannedRequest(["jira"]), "slack"), false);
    }),
    evaluateGate(PHASE1_GATE_CRITERIA[4], () => {
      const prompt = buildMultiToolPlainChatUserPrompt({
        userQuestion: "What changed and why?",
        tools: ["jira", "slack"],
        integrations: {
          jira: { issues: [{ key: "COOP-101", summary: "Ship planner" }] },
          slack: { messages: [{ channelName: "eng", text: "Planner approved" }] }
        }
      });
      assert.match(prompt, /### Jira/);
      assert.match(prompt, /COOP-101: Ship planner/);
      assert.match(prompt, /### Slack/);
      assert.match(prompt, /eng: Planner approved/);
    }),
    evaluateGate(PHASE1_GATE_CRITERIA[5], () => {
      const plan = planChatIntentFromRules({
        message: "Check Jira and Slack for context on this change",
        connectedTools: ["jira", "slack"]
      });
      const integrationProvider = plan.tools.length === 1 ? plan.tools[0] : undefined;
      assert.equal(plan.tools.length, 2);
      assert.equal(integrationProvider, undefined);
      assert.equal("integrationProvider" in plan, false);
    }),
    evaluateGate(
      {
        id: "P1-G7",
        title: "Slack + Notion named → both tools planned"
      },
      () => {
        const plan = planChatIntentFromRules({
          message: "cross-check mentions of IndexedRepoWorkspace in slack and notion",
          connectedTools: ["slack"]
        });
        assert.deepEqual(plan.tools, ["slack", "notion"]);
        assert.equal(plan.mode, "tools-only");
      }
    )
  ];

  assert.equal(results.length, PHASE1_GATE_CRITERIA.length + 1);
  assertAllGatesPass(results, "Phase 1");
});
