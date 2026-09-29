/**
 * Intent quarterback — invent criteria for novel wording; never silent-promote.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { COPILOT_T2_ASK, COPILOT_C2_ASK } from "../../api/agent/dogfoodContract";
import { isApiRejectAsk } from "../../api/agent/searchQuery";
import { planChatIntentFromRules } from "./planChatIntent";
import {
  buildChatIntentPlanUserMessage,
  needsCodeCriteriaQuarterback,
  parseChatIntentPlanResponse,
  shouldCallChatIntentModel
} from "./planChatIntentModel";
import { plannedCodeSearchQueries } from "./planChatJobs";
import { demoteUnconstrainedWorkflow, resolveChatIntentExecution } from "./resolveExecution";
import { emptyChatIntentPlan, type ChatIntentPlan } from "./types";

/** Novel T2 paraphrase — must not appear in product slogan banks. */
const T2_PARAPHRASE =
  "API 400 when the parent issue isn't in this project — where is that rejected?";

/** Novel C2 paraphrase. */
const C2_PARAPHRASE =
  "Moving a work item out of backlog fails with an API error. Where does the server reject a bad state transition?";

test("quarterback is called for locate/reject asks even when rules already planned jobs", () => {
  for (const ask of [COPILOT_T2_ASK, COPILOT_C2_ASK, T2_PARAPHRASE, C2_PARAPHRASE]) {
    const plan = planChatIntentFromRules({ message: ask, connectedTools: [] });
    assert.equal(needsCodeCriteriaQuarterback(plan), true, ask);
    assert.equal(shouldCallChatIntentModel(plan, { message: ask }), true, ask);
  }
});

test("novel T2/C2 paraphrases classify as API reject without product hardcoding", () => {
  assert.equal(isApiRejectAsk(T2_PARAPHRASE), true);
  assert.equal(isApiRejectAsk(C2_PARAPHRASE), true);
});

test("parse model quarterback emits searchCriteria + evidenceClass + purpose", () => {
  const raw = JSON.stringify({
    workflow: "none",
    tools: [],
    confidence: "high",
    purpose: "Find where bad parent issue_id is rejected",
    jobs: [
      {
        capability: "locate",
        verb: "search",
        terms: ["parent issue_id"],
        searchCriteria: [
          "parent isn't in this project",
          "ValidationError parent",
          "Parent is not valid"
        ],
        evidenceClass: "write-reject"
      }
    ]
  });
  const plan = parseChatIntentPlanResponse(raw, [], T2_PARAPHRASE);
  assert.equal(plan.purpose, "Find where bad parent issue_id is rejected");
  assert.equal(plan.jobs?.[0]?.evidenceClass, "write-reject");
  assert.deepEqual(plan.jobs?.[0]?.searchCriteria, [
    "parent isn't in this project",
    "ValidationError parent",
    "Parent is not valid"
  ]);
  assert.deepEqual(plannedCodeSearchQueries(plan.jobs), [
    "parent isn't in this project",
    "ValidationError parent",
    "Parent is not valid"
  ]);
});

test("garbage model plan fails open without promoting a workflow", () => {
  const plan = parseChatIntentPlanResponse("not json at all", [], COPILOT_T2_ASK);
  assert.equal(plan.mode, "none");
  assert.equal(plan.execution, "none");
  assert.equal(plan.workflow, undefined);

  const promoted: ChatIntentPlan = {
    ...emptyChatIntentPlan(COPILOT_T2_ASK),
    mode: "run-workflow",
    workflow: "blast-radius",
    execution: "silent",
    jobs: [
      {
        capability: "locate",
        terms: ["parent"],
        searchCriteria: ["parent ValidationError"],
        evidenceClass: "write-reject"
      }
    ]
  };
  const demoted = demoteUnconstrainedWorkflow(promoted);
  assert.equal(demoted.execution, "none");
  assert.equal(demoted.workflow, undefined);
  assert.notEqual(demoted.mode, "run-workflow");
  assert.equal(resolveChatIntentExecution(demoted).kind, "none");
});

test("quarterback prompt asks for searchCriteria on locate jobs", () => {
  const prompt = buildChatIntentPlanUserMessage(T2_PARAPHRASE, { connectedTools: [] });
  assert.match(prompt, /searchCriteria/);
  assert.match(prompt, /write-reject/);
  assert.match(prompt, /index-ready|ValidationError|get\("field"\)/);
  assert.match(prompt, /work item state/);
  assert.doesNotMatch(prompt, /plane/i);
});

test("plannedCodeSearchQueries prefers searchCriteria over weak terms", () => {
  const queries = plannedCodeSearchQueries([
    {
      capability: "locate",
      terms: ["issue_id"],
      searchCriteria: ["parent not in project", "ValidationError parent"]
    }
  ]);
  assert.deepEqual(queries, ["parent not in project", "ValidationError parent"]);
});
