import assert from "node:assert/strict";
import test from "node:test";
import {
  PHASE2_GATE_CRITERIA,
  assertAllGatesPass,
  gateFail,
  gatePass,
  type GateResult
} from "./gates";
import { planChatIntentFromRules } from "./planChatIntent";
import { parseChatIntentPlanResponse } from "./planChatIntentModel";
import { resolveChatIntentExecution } from "./resolveExecution";
import type { ChatIntentPlan } from "./types";

type Phase2Criterion = (typeof PHASE2_GATE_CRITERIA)[number];

function phase2Criterion(id: Phase2Criterion["id"]): Phase2Criterion {
  const criterion = PHASE2_GATE_CRITERIA.find((entry) => entry.id === id);
  assert.ok(criterion, `Missing Phase 2 criterion ${id}`);
  return criterion;
}

function collectGate(
  results: GateResult[],
  criterion: Phase2Criterion,
  verify: () => void
): void {
  try {
    verify();
    results.push(gatePass(2, criterion.id, criterion.title));
  } catch (error) {
    results.push(
      gateFail(
        2,
        criterion.id,
        criterion.title,
        error instanceof Error ? error.message : String(error)
      )
    );
  }
}

function assertNotPromoted(plan: ChatIntentPlan): void {
  assert.equal(plan.workflow, undefined);
  assert.notEqual(plan.mode, "run-workflow");
  assert.notEqual(plan.mode, "suggest-chips");
  assert.notEqual(plan.execution, "silent");
  assert.notEqual(plan.execution, "confirm");
  const decision = resolveChatIntentExecution(plan);
  assert.ok(decision.kind === "none" || decision.kind === "tools-only");
}

test("Phase 2 Chat Intent Planner gates", () => {
  const results: GateResult[] = [];

  collectGate(results, phase2Criterion("P2-G1"), () => {
    const plan = planChatIntentFromRules({
      message: "What files are impacted if I change this handler?",
      activeFile: "src/chat/handler.ts",
      connectedTools: []
    });

    assertNotPromoted(plan);
    assert.ok(plan.mode === "none" || plan.mode === "plain" || plan.mode === "tools-only");
  });

  collectGate(results, phase2Criterion("P2-G2"), () => {
    const plan = planChatIntentFromRules({
      message: "Which files are impacted by this change? Also check Jira.",
      activeFile: "src/chat/handler.ts",
      connectedTools: ["jira"]
    });

    assertNotPromoted(plan);
    assert.ok(plan.tools.includes("jira"));
    const decision = resolveChatIntentExecution(plan);
    assert.equal(decision.kind, "tools-only");
  });

  collectGate(results, phase2Criterion("P2-G3"), () => {
    const plan = planChatIntentFromRules({
      message: "Give me a repository overview.",
      connectedTools: []
    });

    assertNotPromoted(plan);
    assert.notEqual(plan.mode, "suggest-chips");
  });

  collectGate(results, phase2Criterion("P2-G4"), () => {
    const plan = parseChatIntentPlanResponse(
      '{"workflow":"blast-radius","tools":["jira"],"confidence":"high"}',
      ["jira"],
      "Check the impact and Jira"
    );

    assert.equal(plan.workflow, undefined);
    assert.deepEqual(plan.tools, ["jira"]);
    assert.equal(plan.mode, "tools-only");
    assert.equal(plan.execution, "none");
  });

  collectGate(results, phase2Criterion("P2-G5"), () => {
    const plan: ChatIntentPlan = {
      mode: "run-workflow",
      workflow: "blast-radius",
      tools: ["jira"],
      confidence: "high",
      focus: "Check the impact and Jira",
      execution: "silent"
    };
    const decision = resolveChatIntentExecution(plan);

    assert.equal(decision.kind, "tools-only");
    if (decision.kind !== "tools-only") {
      return;
    }
    assert.deepEqual(decision.tools, ["jira"]);
    assert.equal(decision.plan.workflow, undefined);
    assert.equal(decision.plan.execution, "none");
  });

  collectGate(results, phase2Criterion("P2-G6"), () => {
    const plan = parseChatIntentPlanResponse(
      "not valid model JSON",
      ["jira"],
      "What files are impacted?"
    );

    assert.equal(plan.mode, "none");
    assert.equal(plan.execution, "none");
    assert.equal(plan.workflow, undefined);
    assert.deepEqual(plan.tools, []);
  });

  assert.equal(results.length, PHASE2_GATE_CRITERIA.length);
  assertAllGatesPass(results, "Phase 2");
});
