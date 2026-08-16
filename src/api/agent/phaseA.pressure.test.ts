import assert from "node:assert/strict";
import { AGENT_JOB_WALL_MS } from "../../config/agentJobBudget";
import { MAX_USER_FACING_RESPONSE_MS } from "../../config/responseDeadline";
import { parseAgentToolPlan } from "./parseAgentToolPlan";
import { shouldRunAgentToolLoop } from "../../chat/agentRouting";
import { emptyChatIntentPlan } from "../../chat/intentPlanner/types";
import { PHASE_A_PRESSURE_IDS } from "./gates";

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

test("A-P1 garbage tool JSON is invalid (fail open)", () => {
  assert.equal(parseAgentToolPlan("not json {{{").kind, "invalid");
  assert.ok(PHASE_A_PRESSURE_IDS.includes("A-P1"));
});

test("A-P5 plain explain never loops (no user off switch)", () => {
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
});

test("A-P6 agent wall is not the Q&A 15s gather", () => {
  assert.notEqual(AGENT_JOB_WALL_MS, MAX_USER_FACING_RESPONSE_MS);
  assert.ok(AGENT_JOB_WALL_MS >= 60_000);
});

test("A-P8 local explain does not loop", () => {
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
});

test("A-P10 empty-bundle hunt still loops (always on for hunts)", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Where is auth middleware enforced and what calls it?",
      hasQuickAction: false,
      intentPlan: emptyChatIntentPlan("Where is auth middleware enforced and what calls it?")
    }),
    true
  );
});

test("A-P12 thanks follow-up does not loop (UX-G7)", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "thanks",
      hasQuickAction: false,
      intentPlan: emptyChatIntentPlan("thanks")
    }),
    false
  );
});

test("A-P13 edit turn does not loop (UX-G8)", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Where is auth middleware enforced and what calls it?",
      hasQuickAction: false,
      isEditTurn: true
    }),
    false
  );
});

test("A-P9 named Slack does not loop", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "What's in Slack about this?",
      hasQuickAction: false,
      intentPlan: {
        mode: "tools-only",
        tools: ["slack"],
        confidence: "high",
        focus: "What's in Slack about this?",
        execution: "none"
      }
    }),
    false
  );
});

console.log(`\nphaseA.pressure: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
