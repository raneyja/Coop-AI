import assert from "node:assert/strict";
import {
  isRepoInvestigationQuery,
  plannerAllowsAgentRepoLoop,
  shouldRunAgentToolLoop,
  shouldSuppressSuggestChipsForAgentHunt,
  shouldUseAgentMode
} from "./agentRouting";
import { emptyChatIntentPlan, type ChatIntentPlan } from "./intentPlanner/types";
import { DOGFOOD_HUNT_QUESTION } from "../api/agent/dogfoodContract";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

test("shouldUseAgentMode is false when setting is off", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "how does auth work across the codebase?",
      hasQuickAction: false,
      agentModeSetting: "off"
    }),
    false
  );
});

test("shouldUseAgentMode is true when setting is on for plain chat", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "how does auth work?",
      hasQuickAction: false,
      agentModeSetting: "on"
    }),
    true
  );
});

test("shouldUseAgentMode rejects quick actions even when on", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "blast radius",
      hasQuickAction: true,
      agentModeSetting: "on"
    }),
    false
  );
});

test("shouldUseAgentMode auto triggers on repo-wide search keywords when query is long enough", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "Where is the session token validated across the codebase?",
      hasQuickAction: false,
      agentModeSetting: "auto"
    }),
    true
  );
});

test("shouldUseAgentMode auto ignores short keyword-only queries", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "find auth",
      hasQuickAction: false,
      agentModeSetting: "auto",
      contextBundle: [
        {
          requestId: "1",
          type: "chat_context",
          fetchedAt: new Date(),
          data: { localFiles: { files: [{ path: "src/auth.ts", content: "" }] } }
        }
      ]
    }),
    false
  );
});

test("shouldUseAgentMode auto does not trigger when context bundle is empty (UX-G1)", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "summarize recent changes",
      hasQuickAction: false,
      agentModeSetting: "auto",
      contextBundle: [{ requestId: "1", type: "chat_context", fetchedAt: new Date(), data: {} }]
    }),
    false
  );
});

test("shouldUseAgentMode auto stays off when bundle has localFiles and query is not a hunt", () => {
  assert.equal(
    shouldUseAgentMode({
      query: "summarize recent changes",
      hasQuickAction: false,
      agentModeSetting: "auto",
      contextBundle: [
        {
          requestId: "1",
          type: "chat_context",
          fetchedAt: new Date(),
          data: { localFiles: { files: [{ path: "src/a.ts", content: "" }] } }
        }
      ]
    }),
    false
  );
});

test("shouldRunAgentToolLoop is false for local explain even when on (A-P8)", () => {
  const plan: ChatIntentPlan = {
    ...emptyChatIntentPlan("Explain this function"),
    mode: "plain",
    execution: "none",
    confidence: "high"
  };
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Explain this function",
      hasQuickAction: false,
      agentModeSetting: "on",
      intentPlan: plan
    }),
    false
  );
});

test("shouldRunAgentToolLoop is false for Slack-named ask without a repo hunt (A-P9)", () => {
  const plan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["slack"],
    confidence: "high",
    focus: "What's in Slack about this?",
    execution: "none"
  };
  assert.equal(
    shouldRunAgentToolLoop({
      query: "What's in Slack about this?",
      hasQuickAction: false,
      agentModeSetting: "on",
      intentPlan: plan
    }),
    false
  );
});

test("shouldRunAgentToolLoop is true for a repo hunt when on (A-G1)", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Where is auth middleware enforced and what calls it?",
      hasQuickAction: false,
      agentModeSetting: "on",
      intentPlan: emptyChatIntentPlan("Where is auth middleware enforced and what calls it?")
    }),
    true
  );
});

test("shouldRunAgentToolLoop is false for thanks follow-up (UX-G7)", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "thanks",
      hasQuickAction: false,
      agentModeSetting: "on",
      intentPlan: emptyChatIntentPlan("thanks")
    }),
    false
  );
});

test("shouldRunAgentToolLoop is false for /edit (UX-G8)", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Where is auth middleware enforced and what calls it?",
      hasQuickAction: false,
      agentModeSetting: "on",
      isEditTurn: true
    }),
    false
  );
});

test("plannerAllowsAgentRepoLoop blocks workflows", () => {
  assert.equal(
    plannerAllowsAgentRepoLoop(
      {
        mode: "run-workflow",
        workflow: "trace-decision",
        tools: [],
        confidence: "high",
        focus: "trace the decision",
        execution: "silent"
      },
      "trace the decision in this file please"
    ),
    false
  );
});

test("shouldSuppressSuggestChipsForAgentHunt is true for a location hunt when on", () => {
  assert.equal(
    shouldSuppressSuggestChipsForAgentHunt({
      query: DOGFOOD_HUNT_QUESTION,
      agentModeSetting: "on"
    }),
    true
  );
});

test("shouldSuppressSuggestChipsForAgentHunt is false when off", () => {
  assert.equal(
    shouldSuppressSuggestChipsForAgentHunt({
      query: DOGFOOD_HUNT_QUESTION,
      agentModeSetting: "off"
    }),
    false
  );
});

test("suggest-chips leftover plan blocks the loop; none plan after Just answer allows it", () => {
  const query = DOGFOOD_HUNT_QUESTION;
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      agentModeSetting: "on",
      intentPlan: {
        mode: "suggest-chips",
        workflow: "find-owner",
        tools: [],
        confidence: "medium",
        focus: query,
        execution: "confirm"
      }
    }),
    false
  );
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      agentModeSetting: "on",
      intentPlan: emptyChatIntentPlan(query)
    }),
    true
  );
});

test("isRepoInvestigationQuery requires length and hunt language", () => {
  assert.equal(isRepoInvestigationQuery("ok"), false);
  assert.equal(isRepoInvestigationQuery("Where is the session token validated across the codebase?"), true);
});

console.log(`\nagentRouting: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
