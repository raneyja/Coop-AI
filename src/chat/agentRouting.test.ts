import assert from "node:assert/strict";
import {
  isRepoInvestigationQuery,
  plannerAllowsAgentRepoLoop,
  shouldRunAgentToolLoop,
  shouldSkipAgentHuntForOpenFileFeatureAdd,
  shouldSuppressSuggestChipsForAgentHunt
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

test("shouldRunAgentToolLoop is false for quick actions", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "blast radius",
      hasQuickAction: true
    }),
    false
  );
});

test("shouldRunAgentToolLoop is false for local explain even on a hunt-shaped leftover (A-P8)", () => {
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
      intentPlan: plan
    }),
    false
  );
});

test("shouldRunAgentToolLoop is true for hunt + Slack compound ask (S-G8)", () => {
  const query = "Where is requireAuth defined, and what did Slack say about the auth change?";
  const plan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["slack"],
    confidence: "high",
    focus: query,
    execution: "none",
    codeIntent: { action: "locate", confidence: "high", reason: "asks where something is and names code" }
  };
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: plan
    }),
    true
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
      intentPlan: plan
    }),
    false
  );
});

test("shouldRunAgentToolLoop is true for a repo hunt (always on)", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Where is auth middleware enforced and what calls it?",
      hasQuickAction: false,
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

test("shouldSuppressSuggestChipsForAgentHunt is true for a location hunt", () => {
  assert.equal(
    shouldSuppressSuggestChipsForAgentHunt({
      query: DOGFOOD_HUNT_QUESTION
    }),
    true
  );
});

test("shouldSuppressSuggestChipsForAgentHunt is false for thanks", () => {
  assert.equal(
    shouldSuppressSuggestChipsForAgentHunt({
      query: "thanks"
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
      intentPlan: emptyChatIntentPlan(query)
    }),
    true
  );
});

test("isRepoInvestigationQuery requires length and hunt language", () => {
  assert.equal(isRepoInvestigationQuery("ok"), false);
  assert.equal(isRepoInvestigationQuery("Where is the session token validated across the codebase?"), true);
});

test("open-file feature-add skips the agent hunt so A10 can read the chip file", () => {
  const ask =
    "We're adding a blocked_by issue link type this sprint. Where should validation live, and which existing link types in this mapper should I mirror so we don't fork a second relation model?";
  assert.equal(
    shouldSkipAgentHuntForOpenFileFeatureAdd({
      message: ask,
      openFile: "apps/api/plane/utils/issue_relation_mapper.py"
    }),
    true
  );
  assert.equal(
    shouldSkipAgentHuntForOpenFileFeatureAdd({ message: ask, openFile: undefined }),
    false
  );
  assert.equal(
    shouldSkipAgentHuntForOpenFileFeatureAdd({
      message: "Where is APIKeyAuthentication defined in this repo?",
      openFile: "apps/api/plane/utils/issue_relation_mapper.py"
    }),
    false
  );
});

test("ticket pickup with requireAuth and Jira still runs the hunt (3b)", () => {
  const query =
    "I'm picking up COOP-101 — peel auth into coop-backend. What in this repo still owns requireAuth / request auth, and what's the safest first extraction boundary so we don't break every VS Code session?";
  const plan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["jira"],
    confidence: "high",
    focus: query,
    execution: "none",
    codeIntent: { action: "locate", confidence: "high", reason: "asks where something is and names code" }
  };
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: plan
    }),
    true
  );
});

console.log(`\nagentRouting: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
