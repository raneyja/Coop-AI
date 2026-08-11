import assert from "node:assert/strict";
import test from "node:test";
import {
  PHASE3_GATE_CRITERIA,
  assertAllGatesPass,
  gateFail,
  gatePass,
  type GateResult
} from "./gates";
import {
  buildIntentPlanActivityMessages,
  buildIntentPlanStatusLine,
  buildIntentPlanTrustPreamble
} from "./intentPlanTrust";
import { emptyChatIntentPlan, type ChatIntentPlan } from "./types";

type Phase3Criterion = (typeof PHASE3_GATE_CRITERIA)[number];

function phase3Criterion(id: Phase3Criterion["id"]): Phase3Criterion {
  const criterion = PHASE3_GATE_CRITERIA.find((entry) => entry.id === id);
  assert.ok(criterion, `Missing Phase 3 criterion ${id}`);
  return criterion;
}

function collectGate(
  results: GateResult[],
  criterion: Phase3Criterion,
  verify: () => void
): void {
  try {
    verify();
    results.push(gatePass(3, criterion.id, criterion.title));
  } catch (error) {
    results.push(
      gateFail(
        3,
        criterion.id,
        criterion.title,
        error instanceof Error ? error.message : String(error)
      )
    );
  }
}

const compoundPlan: ChatIntentPlan = {
  mode: "run-workflow",
  workflow: "blast-radius",
  tools: ["jira"],
  confidence: "high",
  focus: "Which files are impacted? Check Jira too.",
  execution: "silent"
};

test("Phase 3 Chat Intent Planner gates", () => {
  const results: GateResult[] = [];

  collectGate(results, phase3Criterion("P3-G1"), () => {
    assert.equal(
      buildIntentPlanStatusLine(compoundPlan),
      "Checking change impact + Jira"
    );
  });

  collectGate(results, phase3Criterion("P3-G2"), () => {
    assert.deepEqual(buildIntentPlanActivityMessages(compoundPlan), [
      "Mapping change impact…",
      "Reviewing Jira tickets…"
    ]);
  });

  collectGate(results, phase3Criterion("P3-G3"), () => {
    const preamble = buildIntentPlanTrustPreamble(compoundPlan);

    assert.ok(preamble);
    assert.match(preamble, /^<coop_intent_plan>/);
    assert.match(preamble, /Checking change impact \+ Jira\./);
    assert.match(
      preamble,
      /Plain chat was routed to the blast-radius workflow automatically\./
    );
    assert.match(preamble, /Connected tools in scope: Jira\./);
    assert.match(preamble, /<\/coop_intent_plan>$/);
  });

  collectGate(results, phase3Criterion("P3-G4"), () => {
    const nonePlan = emptyChatIntentPlan("Explain this function");

    assert.equal(buildIntentPlanStatusLine(nonePlan), undefined);
    assert.deepEqual(buildIntentPlanActivityMessages(nonePlan), []);
    assert.equal(buildIntentPlanTrustPreamble(nonePlan), undefined);
  });

  assert.equal(results.length, PHASE3_GATE_CRITERIA.length);
  assertAllGatesPass(results, "Phase 3");
});
