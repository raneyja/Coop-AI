/**
 * Golden corpus: plain English must not enter slash / quick-action pipelines.
 */
import assert from "node:assert/strict";
import { planChatFrontDoorFromRules, planRawChatAskFromRules } from "./intentPlanner/frontDoor";
import { resolveChatIntentExecution } from "./intentPlanner/resolveExecution";
import type { ChatIntentPlan } from "./intentPlanner/types";
import { resolveChangeSendRouting } from "./editSendRouting";
import { resolveEffectiveQuickAction } from "./effectiveQuickAction";
import { resolvePlainChatIntegrationProvider } from "./integrationProviderRouting";
import type { ChatMessage } from "./types";
import { shouldRunAgentToolLoop } from "./agentRouting";
import { classifyRepoCodeIntent } from "./repoCodeIntent";
import { isFileCallerQuery } from "../context/fileCallerIntent";

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

function userMessage(content: string): ChatMessage {
  return { role: "user", content, timestamp: Date.now() };
}

function planFor(message: string, activeFile?: string): ChatIntentPlan {
  return planChatFrontDoorFromRules({
    message,
    activeFile,
    connectedTools: ["slack", "jira", "confluence"]
  });
}

function assertStaysPlainChat(message: string, activeFile?: string): ChatIntentPlan {
  const plan = planFor(message, activeFile);
  assert.equal(plan.workflow, undefined, `${message} planned a workflow`);
  assert.notEqual(plan.mode, "run-workflow", message);
  assert.notEqual(plan.mode, "suggest-chips", message);
  assert.notEqual(plan.execution, "silent", message);
  assert.notEqual(plan.execution, "confirm", message);
  const decision = resolveChatIntentExecution(plan);
  assert.ok(decision.kind === "none" || decision.kind === "tools-only", `${message} → ${decision.kind}`);
  const raw = planRawChatAskFromRules(message, {
    activeFile,
    connectedTools: ["slack", "jira", "confluence"]
  });
  assert.equal(raw.constraint.kind, "none", `${message} got a slash constraint`);
  return plan;
}

const BLAST_SHAPED = [
  "If I change that missing-key response, what else in this repo should I check before I ship?",
  "If I modify this function, what else is affected?",
  "What breaks if I change this handler?",
  "What's the blast radius of renaming validate_identifier?",
  "Who calls sendSigningEmail?",
  "Is it safe to change these enum values?"
];

const OTHER_QA_SHAPED = [
  "Who owns auth?",
  "Why was this designed this way?",
  "How is this repository structured?",
  "What are the knowledge gaps in auth?"
];

for (const ask of BLAST_SHAPED) {
  test(`blast-shaped stays plain: ${ask}`, () => {
    const plan = assertStaysPlainChat(ask);
    assertStaysPlainChat(ask, "src/chat/handler.ts");
    assert.equal(isFileCallerQuery(ask), true, ask);
    assert.equal(classifyRepoCodeIntent(ask).action, "locate", ask);
    assert.equal(
      shouldRunAgentToolLoop({ query: ask, hasQuickAction: false, intentPlan: plan }),
      true,
      ask
    );
  });
}

for (const ask of OTHER_QA_SHAPED) {
  test(`QA-shaped stays plain: ${ask}`, () => {
    assertStaysPlainChat(ask);
  });
}

test("edit-shaped English does not set anchored /edit", () => {
  const ask = "Add a null check to requireAuth in this file";
  assertStaysPlainChat(ask, "src/server/authMiddleware.ts");
  assert.deepEqual(
    resolveChangeSendRouting({
      explicitEdit: false,
      concreteEditAsk: true,
      hasEditTarget: true,
      agentCanOwnChange: true
    }),
    { kind: "agent-change" }
  );
});

test("explicit /edit still anchors", () => {
  assert.deepEqual(
    resolveChangeSendRouting({
      explicitEdit: true,
      concreteEditAsk: false,
      hasEditTarget: true,
      agentCanOwnChange: true
    }),
    { kind: "anchored-edit" }
  );
});

test("named Slack prefetches tools but does not set /slack constraint", () => {
  const ask = "What did Slack say about the SQL-injection PR?";
  const plan = assertStaysPlainChat(ask);
  assert.ok(plan.tools.includes("slack"));
  const decision = resolveChatIntentExecution(plan);
  assert.equal(decision.kind, "tools-only");
  assert.equal(
    resolvePlainChatIntegrationProvider({ message: ask, isConnected: () => true }),
    undefined
  );
  const raw = planRawChatAskFromRules(ask, { connectedTools: ["slack", "jira"] });
  assert.equal(raw.constraint.kind, "none");
});

test("explicit /blast still pins the blast engine", () => {
  const turn = planRawChatAskFromRules("/blast", {
    connectedTools: ["jira"],
    activeFile: "src/chat/handler.ts"
  });
  assert.equal(turn.constraint.kind, "workflow");
  if (turn.constraint.kind === "workflow") {
    assert.equal(turn.constraint.workflow, "blast-radius");
  }
  assert.equal(turn.plan.workflow, "blast-radius");
  assert.equal(turn.plan.mode, "run-workflow");
});

test("explicit /slack still pins Slack", () => {
  const turn = planRawChatAskFromRules("/slack topic", {
    connectedTools: ["slack", "jira"]
  });
  assert.equal(turn.constraint.kind, "integration");
  if (turn.constraint.kind === "integration") {
    assert.equal(turn.constraint.provider, "slack");
  }
  assert.deepEqual(turn.plan.tools, ["slack"]);
});

test("plain follow-up after /blast does not inherit Blast", () => {
  const history = [userMessage("/blast")];
  assert.equal(resolveEffectiveQuickAction(undefined, history), undefined);
  assert.equal(resolveEffectiveQuickAction("blast-radius", history), "blast-radius");
});

console.log(`\nplainChatMustNotPromote: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
