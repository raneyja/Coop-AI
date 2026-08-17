import assert from "node:assert/strict";
import { AGENT_JOB_WALL_MS, AGENT_MAX_TOOL_ROUNDS } from "../../config/agentJobBudget";
import { MAX_USER_FACING_RESPONSE_MS } from "../../config/responseDeadline";
import { PHASE_A_GATE_IDS, UX_FREEZE_GATE_IDS } from "./gates";
import { parseAgentToolPlan } from "./parseAgentToolPlan";
import { shouldRunAgentToolLoop } from "../../chat/agentRouting";
import { emptyChatIntentPlan } from "../../chat/intentPlanner/types";

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

test("A-G0 agent job budget is not the 15s Q&A gather", () => {
  assert.ok(AGENT_JOB_WALL_MS > MAX_USER_FACING_RESPONSE_MS);
  assert.equal(AGENT_MAX_TOOL_ROUNDS, 8);
  assert.ok(PHASE_A_GATE_IDS.includes("A-G0"));
  assert.ok(UX_FREEZE_GATE_IDS.includes("UX-G1"));
});

test("A-G4 / A-G7 Trace/workflow does not enter the loop", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "trace the decision for this auth change",
      hasQuickAction: true
    }),
    false
  );
});

test("A-G7 Slack-named ask does not run search_code", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "What's in Slack about this login bug?",
      hasQuickAction: false,
      intentPlan: {
        mode: "tools-only",
        tools: ["slack"],
        confidence: "high",
        focus: "What's in Slack about this login bug?",
        execution: "none"
      }
    }),
    false
  );
});

test("A-G1 repo hunt is allowed (always on)", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Where is auth middleware enforced and what calls it?",
      hasQuickAction: false,
      intentPlan: emptyChatIntentPlan("Where is auth middleware enforced and what calls it?")
    }),
    true
  );
});

test("A-G6 / UX-G1 plain explain never loops; hunts always do", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Explain this function",
      hasQuickAction: false,
      intentPlan: {
        mode: "plain",
        tools: [],
        confidence: "high",
        focus: "Explain this function",
        execution: "none"
      }
    }),
    false
  );
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Where is auth middleware enforced and what calls it?",
      hasQuickAction: false,
      intentPlan: emptyChatIntentPlan("Where is auth middleware enforced and what calls it?")
    }),
    true
  );
});

test("parseAgentToolPlan rejects Slack as a repo tool (UX-G2)", () => {
  const parsed = parseAgentToolPlan(JSON.stringify({ tool: "slack_search", args: {} }));
  assert.equal(parsed.kind, "invalid");
});

test("A-G7 Slack-only stays out; hunt + Slack loops", () => {
  const huntSlack = "Where is requireAuth defined, and what did Slack say about the auth change?";
  assert.equal(
    shouldRunAgentToolLoop({
      query: "What's in Slack about this login bug?",
      hasQuickAction: false,
      intentPlan: {
        mode: "tools-only",
        tools: ["slack"],
        confidence: "high",
        focus: "What's in Slack about this login bug?",
        execution: "none"
      }
    }),
    false
  );
  assert.equal(
    shouldRunAgentToolLoop({
      query: huntSlack,
      hasQuickAction: false,
      intentPlan: {
        mode: "tools-only",
        tools: ["slack"],
        confidence: "high",
        focus: huntSlack,
        execution: "none",
        codeIntent: { action: "locate", confidence: "high", reason: "test" }
      }
    }),
    true
  );
});

test("parseAgentToolPlan accepts search_jira when Jira is allowlisted", () => {
  const parsed = parseAgentToolPlan(
    JSON.stringify({ tool: "search_jira", args: { query: "PROJ-123" } }),
    { allowedIntegrations: ["jira"] }
  );
  assert.equal(parsed.kind, "call");
  if (parsed.kind === "call") {
    assert.equal(parsed.tool, "search_jira");
  }
});

test("parseAgentToolPlan accepts search_code JSON", () => {
  const parsed = parseAgentToolPlan('{"tool":"search_code","args":{"query":"auth"}}');
  assert.equal(parsed.kind, "call");
  if (parsed.kind === "call") {
    assert.equal(parsed.tool, "search_code");
  }
});

console.log(`\nphaseA.gates: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
