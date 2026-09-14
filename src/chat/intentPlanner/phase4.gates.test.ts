/**
 * Phase 4 — Chat Intent jobs: compound locate+decision, per-job terms,
 * named-tool floor, host/integration siblings, fail-open, empty hits.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { planChatIntentFromRules } from "./planChatIntent";
import {
  codeHostJobTerms,
  codeHostJobQuery,
  extraTermsForIntegration,
  hasCodeHostJob,
  jobsSkipAgentLoop,
  locateJobTerms,
  planChatJobs,
  shouldOverlapIntegrationPrefetch,
  stripLeadingAskLabels,
  wantsExplicitCodeHostSearch
} from "./planChatJobs";
import { jobsGuaranteeLocatePrefetch, shouldRunAgentToolLoop } from "../agentRouting";
import { shouldCallChatIntentModel } from "./planChatIntentModel";
import { shouldCallChatIntentModel } from "./planChatIntentModel";
import { wantsCodeHostContext } from "../../context/codeHostContext";
import { buildDiscussionSearchQueries } from "../../context/integrationSearchTerms";
import { CODE_HOST_PROVIDERS } from "../../api/codeHosts/types";
import { locateJobIndexQueries } from "../../api/agent/searchQuery";
import { buildMultiToolPlainChatUserPrompt } from "../../prompts/multiToolPlainChatSynthesis";
import {
  PHASE4_GATE_CRITERIA,
  assertAllGatesPass,
  gateFail,
  gatePass,
  type GateResult
} from "./gates";
import { remainingContextGatherBudgetMs, MAX_USER_FACING_RESPONSE_MS } from "../../config/responseDeadline";

type Phase4Criterion = (typeof PHASE4_GATE_CRITERIA)[number];

function phase4Criterion(id: Phase4Criterion["id"]): Phase4Criterion {
  const criterion = PHASE4_GATE_CRITERIA.find((entry) => entry.id === id);
  assert.ok(criterion, `Missing Phase 4 criterion ${id}`);
  return criterion;
}

function collectGate(
  results: GateResult[],
  criterion: Phase4Criterion,
  verify: () => void
): void {
  try {
    verify();
    results.push(gatePass(4, criterion.id, criterion.title));
  } catch (error) {
    results.push(
      gateFail(
        4,
        criterion.id,
        criterion.title,
        error instanceof Error ? error.message : String(error)
      )
    );
  }
}

/** Class example N5 — leading label + locate + decision. Ellipsis holds code names. */
export const N5_COMPOUND_ASK =
  "Pager: Where is date math implemented — DateTimeUtils, reports.jsp — and did we already decide not to mix this into the SQL-injection PR?";

const N5_EXACT_ASK =
  "Pager: Where is date math implemented, and did we already decide not to mix this into the SQL-injection PR?";

const I3_COMPOUND_ASK =
  "Where is requireAuth defined, and what did we already decide about peeling auth into coop-backend?";

test("Phase 4 Chat Intent job gates", () => {
  const results: GateResult[] = [];

  collectGate(results, phase4Criterion("P4-G1"), () => {
    const rows = [
      {
        ask: N5_COMPOUND_ASK,
        activeFile: "web/reports.jsp"
      },
      {
        ask: N5_EXACT_ASK,
        activeFile: "web/reports.jsp"
      }
    ];
    for (const row of rows) {
      const plan = planChatIntentFromRules({
        message: row.ask,
        activeFile: row.activeFile,
        connectedTools: ["slack", "jira", "confluence", "teams"]
      });
      const capabilities = (plan.jobs ?? []).map((job) => job.capability);
      assert.ok(capabilities.includes("locate"), `${row.ask}: missing locate`);
      assert.ok(capabilities.includes("decision"), `${row.ask}: missing decision`);
      assert.equal(hasCodeHostJob(plan.jobs), false, `${row.ask}: must not search MRs`);

      const locate = locateJobTerms(plan.jobs).map((term) => term.toLowerCase());
      const decision = extraTermsForIntegration(plan.jobs, "slack") ?? [];
      const decisionLc = decision.map((term) => term.toLowerCase());

      assert.ok(
        locate.some((term) => term.includes("date") && term.includes("math")),
        `${row.ask}: locate terms ${locate.join("|")}`
      );
      assert.equal(
        locate.some((term) => term.includes("pager")),
        false,
        "Pager is metadata, not a locate term"
      );
      assert.ok(
        decisionLc.some((term) => term.includes("sql-injection") || term.includes("sql injection")),
        `${row.ask}: decision terms ${decisionLc.join("|")}`
      );
      assert.ok(
        decisionLc.some((term) => term.includes("mix")),
        `${row.ask}: decision missing mix phrase`
      );
      assert.equal(
        decisionLc.some((term) => term.includes("date math") || term === "datetimeutils"),
        false,
        "locate terms must not be copied onto decision"
      );
      assert.ok(plan.tools.includes("slack") && plan.tools.includes("jira"));
      assert.equal(jobsSkipAgentLoop(plan.jobs), true);
      assert.equal(
        shouldRunAgentToolLoop({
          query: row.ask,
          hasQuickAction: false,
          intentPlan: plan
        }),
        false
      );
    }

    const namedNames = planChatIntentFromRules({
      message: N5_COMPOUND_ASK,
      activeFile: "web/reports.jsp",
      connectedTools: ["slack", "jira"]
    });
    const locate = locateJobTerms(namedNames.jobs);
    assert.ok(locate.some((term) => /DateTimeUtils/i.test(term)));
    assert.ok(locate.some((term) => /reports\.jsp/i.test(term)));
    assert.ok(namedNames.tasks?.some((task) => task.job === "locate"));
    assert.ok(namedNames.todos?.some((todo) => /DateTimeUtils|reports\.jsp/i.test(todo.content)));
    assert.ok(namedNames.tasks?.some((task) => task.tool === "slack"));
    assert.ok(namedNames.tasks?.some((task) => task.tool === "jira"));
  });

  collectGate(results, phase4Criterion("P4-G2"), () => {
    const plan = planChatIntentFromRules({
      message: "cross-check mentions of IndexedRepoWorkspace in slack and confluence",
      connectedTools: ["slack"]
    });
    assert.ok(plan.tools.includes("slack"));
    assert.ok(plan.tools.includes("confluence"));
    assert.equal(plan.mode, "tools-only");
    const slackTerms = extraTermsForIntegration(plan.jobs, "slack") ?? [];
    const docsTerms = extraTermsForIntegration(plan.jobs, "confluence") ?? [];
    assert.ok(
      slackTerms.some((term) => /IndexedRepoWorkspace/i.test(term)) ||
        docsTerms.some((term) => /IndexedRepoWorkspace/i.test(term))
    );
  });

  collectGate(results, phase4Criterion("P4-G3"), () => {
    assert.equal(wantsExplicitCodeHostSearch(N5_COMPOUND_ASK), false);
    assert.equal(wantsCodeHostContext(N5_COMPOUND_ASK), false);
    assert.equal(wantsCodeHostContext("did we mix this into the SQL-injection PR?"), false);
    assert.equal(wantsCodeHostContext("search gitlab merge requests for auth"), true);
    assert.equal(wantsCodeHostContext("list bitbucket pull requests for this repo"), true);
    assert.equal(wantsCodeHostContext("any open pull requests for this repo?"), true);
    assert.deepEqual([...CODE_HOST_PROVIDERS], ["github", "gitlab", "bitbucket"]);
    const hostJobs = planChatJobs({ message: "search gitlab merge requests for auth in PR #53" });
    assert.deepEqual(codeHostJobTerms(hostJobs), ["PR #53", "auth 53"]);
  });

  collectGate(results, phase4Criterion("P4-G4"), () => {
    const withSiblings = planChatIntentFromRules({
      message: N5_EXACT_ASK,
      connectedTools: ["slack", "jira", "teams", "confluence"]
    });
    assert.ok(withSiblings.tools.includes("slack"));
    assert.ok(withSiblings.tools.includes("jira"));
    assert.equal(withSiblings.tools.includes("teams"), false);
    assert.equal(withSiblings.tools.includes("confluence"), false);

    const namedOnly = planChatIntentFromRules({
      message: "search slack for discussions about this file",
      connectedTools: ["slack", "teams", "jira"]
    });
    assert.deepEqual(namedOnly.tools, ["slack"]);
  });

  collectGate(results, phase4Criterion("P4-G5"), () => {
    const prompt = buildMultiToolPlainChatUserPrompt({
      userQuestion: N5_EXACT_ASK,
      tools: ["jira", "slack"],
      integrations: {
        jira: { issues: [], error: undefined },
        slack: { messages: [] }
      },
      connected: { jira: true, slack: true }
    });
    assert.match(prompt, /no hits|empty/i);
    assert.match(prompt, /Decision claims require the integration evidence/i);
    assert.match(prompt, /no mention of the decision topic/i);
    assert.doesNotMatch(prompt, /the team decided not to/i);

    const authTimeout = buildMultiToolPlainChatUserPrompt({
      userQuestion: N5_EXACT_ASK,
      tools: ["jira", "slack", "confluence"],
      integrations: {
        jira: { error: "401 Unauthorized" },
        slack: { error: "timed out" },
        confluence: { error: "404 not found" }
      },
      connected: { jira: true, slack: true, confluence: true }
    });
    assert.match(authTimeout, /401 Unauthorized/);
    assert.match(authTimeout, /timed out/);
    assert.match(authTimeout, /404 not found/);
    assert.match(authTimeout, /Do not pretend a tool was searched/i);
  });

  collectGate(results, phase4Criterion("P4-G6"), () => {
    const stalled = planChatIntentFromRules({
      message: "ok",
      connectedTools: ["slack"]
    });
    assert.equal((stalled.jobs ?? []).length, 0);
    const hunt = planChatIntentFromRules({
      message: "Where is requireAuth defined in this repo?",
      connectedTools: []
    });
    assert.equal(jobsSkipAgentLoop(hunt.jobs), false);
    assert.equal(
      shouldRunAgentToolLoop({
        query: "Where is requireAuth defined in this repo?",
        hasQuickAction: false,
        intentPlan: hunt
      }),
      true
    );
    assert.ok(remainingContextGatherBudgetMs(Date.now()) <= MAX_USER_FACING_RESPONSE_MS);
    assert.equal(stripLeadingAskLabels("On-call: where is date math implemented?"), "where is date math implemented?");
    assert.deepEqual(locateJobIndexQueries(["date math"]), ["date math", "date", "math"]);
    assert.deepEqual(locateJobIndexQueries(["date math", "DateTimeUtils", "reports.jsp"]), [
      "reports.jsp",
      "DateTimeUtils",
      "date math"
    ]);
  });

  assert.equal(results.length, PHASE4_GATE_CRITERIA.length);
  assertAllGatesPass(results, "Phase 4");
});

test("job-scoped discussion queries use job terms only", () => {
  const queries = buildDiscussionSearchQueries({
    owner: "acme",
    repo: "app",
    queryText: "Pager: Where is date math implemented, and did we decide?",
    extraTerms: ["don't mix", "sql-injection"],
    jobScoped: true,
    preferHost: "gitlab"
  });
  assert.ok(queries.includes("don't mix"));
  assert.ok(queries.includes("sql-injection"));
  assert.equal(
    queries.some((query) => /pager/i.test(query) || /date math/i.test(query)),
    false
  );
});

test("planChatJobs does not copy one token to every capability", () => {
  const jobs = planChatJobs({
    message: N5_COMPOUND_ASK,
    activeFile: "web/reports.jsp"
  });
  const locate = jobs.find((job) => job.capability === "locate")?.terms ?? [];
  const decision = jobs.find((job) => job.capability === "decision")?.terms ?? [];
  assert.notDeepEqual(locate, decision);
  assert.ok(locate.length > 0 && decision.length > 0);
});

test("compound locate and decision sibling wording stays job-scoped", () => {
  const asks = [
    "Where is date math implemented and what did we decide about the SQL-injection PR?",
    "Where is date math implemented; what does the SQL-injection PR say about rounding?",
    "Where is date math implemented — where did we decide how the SQL-injection PR should handle it?",
    "Where is DateTimeUtils in reports.jsp, and what did we decide about the SQL-injection PR?"
  ];

  for (const ask of asks) {
    const jobs = planChatJobs({ message: ask, activeFile: "web/reports.jsp" });
    const locate = locateJobTerms(jobs).map((term) => term.toLowerCase());
    const decision = extraTermsForIntegration(jobs, "slack")?.map((term) =>
      term.toLowerCase()
    ) ?? [];
    assert.ok(jobs.some((job) => job.capability === "locate"), ask);
    assert.ok(jobs.some((job) => job.capability === "decision"), ask);
    assert.equal(hasCodeHostJob(jobs), false, ask);
    assert.ok(locate.some((term) => /date|datetimeutils|reports\.jsp/.test(term)), ask);
    assert.ok(decision.some((term) => /sql-injection|rounding/.test(term)), ask);
    assert.equal(decision.some((term) => term.includes("date math")), false, ask);
  }
});

test("code-host jobs require explicit listing intent and carry execution terms", () => {
  const rows = [
    {
      ask: "Find the issue in the authentication middleware",
      expected: false
    },
    {
      ask: "list GitLab issues for authentication",
      expected: true
    },
    {
      ask: "what happened in PR #53?",
      expected: true
    }
  ];

  for (const row of rows) {
    const jobs = planChatJobs({ message: row.ask });
    assert.equal(hasCodeHostJob(jobs), row.expected, row.ask);
    assert.equal(Boolean(codeHostJobQuery(jobs)), row.expected, row.ask);
  }
});

test("who decided plus where is stays a job turn, not silent Trace Decision", () => {
  const plan = planChatIntentFromRules({
    message:
      "Who decided not to mix date math into the SQL-injection PR, and where is DateTimeUtils?",
    connectedTools: ["slack", "jira", "confluence"]
  });
  assert.equal(plan.mode, "tools-only");
  assert.equal(plan.workflow, undefined);
  assert.ok((plan.jobs ?? []).some((job) => job.capability === "locate"));
  assert.ok((plan.jobs ?? []).some((job) => job.capability === "decision"));
  assert.ok(plan.todos?.some((todo) => /DateTimeUtils/i.test(todo.content)));
  assert.ok(plan.todos?.some((todo) => /Jira/i.test(todo.content)));
});

test("deterministic rules plans cannot be overwritten by the model classifier", () => {
  const asks = [
    N5_EXACT_ASK,
    "Where is date math implemented and what did we decide about the SQL-injection PR?",
    "Find the issue in the authentication middleware"
  ];

  for (const message of asks) {
    const plan = planChatIntentFromRules({
      message,
      activeFile: "src/server/authMiddleware.ts",
      connectedTools: ["slack", "jira"]
    });
    assert.equal(shouldCallChatIntentModel(plan), false, message);
    assert.ok((plan.jobs?.length ?? 0) > 0 || plan.codeIntent?.action !== "none", message);
  }
});

test("I3 compound locate+decision splits requireAuth from peel-auth and skips unnamed docs", () => {
  const plan = planChatIntentFromRules({
    message: I3_COMPOUND_ASK,
    connectedTools: ["slack", "jira", "confluence", "notion", "google-docs", "teams"]
  });
  const capabilities = (plan.jobs ?? []).map((job) => job.capability);
  assert.ok(capabilities.includes("locate"));
  assert.ok(capabilities.includes("decision"));

  const locate = locateJobTerms(plan.jobs);
  const decision = extraTermsForIntegration(plan.jobs, "slack") ?? [];
  const decisionBlob = decision.join(" ").toLowerCase();
  assert.ok(locate.some((term) => /requireAuth/i.test(term)), locate.join("|"));
  assert.match(decisionBlob, /peel/);
  assert.match(decisionBlob, /auth/);
  assert.match(decisionBlob, /coop-backend|coop backend/);
  assert.equal(decision.some((term) => /requireAuth/i.test(term)), false);
  assert.ok(plan.tools.includes("slack") && plan.tools.includes("jira"));
  assert.equal(plan.tools.includes("confluence"), false);
  assert.equal(plan.tools.includes("notion"), false);
  assert.equal(plan.tools.includes("google-docs"), false);

  assert.equal(jobsSkipAgentLoop(plan.jobs), true);
  assert.equal(jobsGuaranteeLocatePrefetch(plan.jobs), true);
  assert.equal(shouldOverlapIntegrationPrefetch(plan.jobs), false);
  assert.equal(
    shouldRunAgentToolLoop({
      query: I3_COMPOUND_ASK,
      hasQuickAction: false,
      intentPlan: plan
    }),
    false
  );
  assert.equal(
    shouldRunAgentToolLoop({
      query: I3_COMPOUND_ASK,
      hasQuickAction: false,
      intentPlan: plan,
      integrationSlash: true
    }),
    false
  );
});
