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
  classifyChatIntentPlan,
  ensureCompoundWriteRejectJobs,
  needsCodeCriteriaQuarterback,
  parseChatIntentPlanResponse,
  shouldCallChatIntentModel
} from "./planChatIntentModel";
import { plannedCodeSearchQueries, formatIntentBriefForAgent } from "./planChatJobs";
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

test("compound evidence repair returns a new jobs array and preserves the input plan", () => {
  const original = [{ capability: "locate" as const, terms: ["work item state"] }];
  const repaired = ensureCompoundWriteRejectJobs(
    original,
    COPILOT_C2_ASK
  );

  assert.notEqual(repaired, original);
  assert.equal(original.length, 1);
  assert.equal(original[0]?.evidenceClass, undefined);
  assert.ok(repaired.some((job) => job.evidenceClass === "write-site"));
  assert.ok(repaired.some((job) => job.evidenceClass === "write-reject"));
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
  assert.match(prompt, /not calm locate topics or English summaries/i);
  assert.match(prompt, /two locate jobs/);
  assert.match(prompt, /write-site/);
  assert.match(prompt, /evidenceClass[^\n]*write-site/);
  assert.match(prompt, /Do not invent class names, file paths, or serializer symbols/);
  assert.doesNotMatch(prompt, /IssueTransitionSerializer/);
  assert.doesNotMatch(prompt, /plane/i);
});

test("parent paraphrase stays a single reject evidence need without requiring quoted wording", () => {
  const plan = parseChatIntentPlanResponse(JSON.stringify({
    confidence: "high",
    purpose: "Find the server validation for a parent outside the project",
    jobs: [{
      capability: "locate",
      terms: ["parent issue_id"],
      searchCriteria: ["parent issue_id", "parent project validation"],
      evidenceClass: "write-reject"
    }]
  }), [], T2_PARAPHRASE);
  assert.equal(plan.jobs?.length, 1);
  assert.equal(plan.jobs?.[0]?.evidenceClass, "write-reject");
  assert.deepEqual(plan.jobs?.[0]?.searchCriteria, ["parent issue_id", "parent project validation"]);
});

test("compound state ask carries separate write-site and reject evidence needs", () => {
  const plan = parseChatIntentPlanResponse(JSON.stringify({
    confidence: "high",
    purpose: "Locate the server state write and its invalid-transition validation",
    jobs: [
      { capability: "locate", terms: ["state"], searchCriteria: ["state assignment", "state update"], evidenceClass: "write-site" },
      { capability: "locate", terms: ["state transition"], searchCriteria: ["state validation", "invalid state"], evidenceClass: "write-reject" }
    ]
  }), [], C2_PARAPHRASE);
  assert.deepEqual(plan.jobs?.map((job) => job.evidenceClass), ["write-site", "write-reject"]);
  assert.equal(plan.jobs?.length, 2, "both requested evidence needs must survive parsing");
  const brief = formatIntentBriefForAgent({ jobs: plan.jobs });
  assert.match(brief ?? "", /Write-site:/);
  assert.match(brief ?? "", /Write-reject:/);
});

test("production intent classification restores both D2 evidence floors when model omits one", async () => {
  const promptCheck = (message: string) => {
    assert.match(message, /evidenceClass[^\n]*write-site/);
  };
  const bothJobsStub = async ({ message }: { message: string }) => {
    promptCheck(message);
    return JSON.stringify({
      confidence: "high",
      purpose: "Find where state is written and what rejects an invalid transition",
      jobs: [
        {
          capability: "locate",
          terms: ["state write"],
          searchCriteria: ["state assignment", "state update"],
          evidenceClass: "write-site"
        },
        {
          capability: "locate",
          terms: ["bad transition"],
          searchCriteria: ["state validation", "invalid transition"],
          evidenceClass: "write-reject"
        }
      ]
    });
  };
  const plan = await classifyChatIntentPlan(
    { message: COPILOT_C2_ASK, connectedTools: [] },
    bothJobsStub,
    { timeoutMs: 2_000 }
  );

  assert.ok(plan);
  const locateJobs = plan.jobs?.filter((job) => job.capability === "locate") ?? [];
  assert.ok(locateJobs.some((job) => job.evidenceClass === "write-site"));
  assert.ok(locateJobs.some((job) => job.evidenceClass === "write-reject"));
  assert.ok(locateJobs.some((job) => job.searchCriteria?.includes("state assignment")));
  assert.ok(locateJobs.some((job) => job.searchCriteria?.includes("state validation")));
  const brief = formatIntentBriefForAgent({ purpose: plan.purpose, jobs: locateJobs });
  assert.match(brief ?? "", /evidence=write-site/);
  assert.match(brief ?? "", /evidence=write-reject/);

  const misclassifiedStub = async ({ message }: { message: string }) => {
    promptCheck(message);
    return JSON.stringify({
      confidence: "high",
      purpose: "Find where state is written and what rejects an invalid transition",
      jobs: [{
        capability: "locate",
        terms: ["work item state"],
        searchCriteria: ["work item state", "backlog"],
        evidenceClass: "definition-locate"
      }]
    });
  };
  const repaired = await classifyChatIntentPlan(
    { message: COPILOT_C2_ASK, connectedTools: [] },
    misclassifiedStub,
    { timeoutMs: 2_000 }
  );
  assert.ok(repaired);
  assert.ok(repaired.jobs?.some((job) => job.evidenceClass === "write-site"));
  assert.ok(repaired.jobs?.some((job) => job.evidenceClass === "write-reject"));
});

test("calm state definition locate remains distinct from reject intent", () => {
  const calmAsk = "Where do work-item states live in the backend?";
  const calmPlan = parseChatIntentPlanResponse(JSON.stringify({
    confidence: "high",
    purpose: "Locate the state model declaration",
    jobs: [{
      capability: "locate",
      terms: ["work-item state"],
      searchCriteria: ["State model", "state declaration"],
      evidenceClass: "definition-locate"
    }]
  }), [], calmAsk);
  assert.equal(calmPlan.jobs?.[0]?.evidenceClass, "definition-locate");
  assert.equal(calmPlan.jobs?.some((job) => job.evidenceClass === "write-reject"), false);
  assert.equal(isApiRejectAsk(calmAsk), false);
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

test("formatIntentBriefForAgent includes write-reject done-looks-like", () => {
  const brief = formatIntentBriefForAgent({
    purpose: "Attach parent ValidationError",
    jobs: [
      {
        capability: "locate",
        terms: ["parent"],
        searchCriteria: ["Parent is not valid"],
        evidenceClass: "write-reject"
      }
    ]
  });
  assert.match(brief ?? "", /Attach parent ValidationError/);
  assert.match(brief ?? "", /write-reject/);
  assert.match(brief ?? "", /Parent is not valid/);
  assert.match(brief ?? "", /serializers\/views/i);
});
