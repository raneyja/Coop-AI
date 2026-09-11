/**
 * Phase 4 — Chat Intent jobs: compound locate+decision, per-job terms,
 * named-tool floor, host/integration siblings, fail-open, empty hits.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { planChatIntentFromRules } from "./planChatIntent";
import {
  extraTermsForIntegration,
  hasCodeHostJob,
  jobsSkipAgentLoop,
  locateJobTerms,
  planChatJobs,
  stripLeadingAskLabels,
  wantsExplicitCodeHostSearch
} from "./planChatJobs";
import { shouldRunAgentToolLoop } from "../agentRouting";
import { wantsCodeHostContext } from "../../context/codeHostContext";
import { buildDiscussionSearchQueries } from "../../context/integrationSearchTerms";
import { CODE_HOST_PROVIDERS } from "../../api/codeHosts/types";
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
  });

  collectGate(results, phase4Criterion("P4-G4"), () => {
    const withSiblings = planChatIntentFromRules({
      message: N5_EXACT_ASK,
      connectedTools: ["slack", "jira", "teams", "confluence"]
    });
    assert.ok(withSiblings.tools.includes("slack"));
    assert.ok(withSiblings.tools.includes("jira"));
    assert.ok(withSiblings.tools.includes("teams"));
    assert.ok(withSiblings.tools.includes("confluence"));

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
    assert.match(prompt, /do not invent that a decision never existed/i);
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
    assert.match(authTimeout, /do not invent that a decision never existed/i);
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
