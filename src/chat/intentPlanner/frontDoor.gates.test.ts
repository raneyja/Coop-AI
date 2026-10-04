/**
 * Front door gates — live send-path decision, not extractJobTerms-only.
 * Restoring the slash bypass (skip planner for /slack) must fail these tests.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { ThreadRunManager, SESSION_RUN_THREAD_ID } from "../chatTurn";
import {
  extraTermsForIntegration,
  formatIntentBriefForAgent,
  jobVerbForIntegration
} from "./planChatJobs";
import { parseChatIntentPlanResponse, shouldCallChatIntentModel } from "./planChatIntentModel";
import { TEAMS_COMING_SOON } from "../../integrations/teamsAvailability";
import {
  SLACK_SQL_INJECTION_SLASH_ASK,
  hasAskTopic,
  mergeInterpreterJobs,
  jobScopedActivityQuery,
  planChatFrontDoor,
  planChatFrontDoorFromRules,
  planRawChatAskFromRules,
  shouldInterpretChatAsk
} from "./frontDoor";

const USE_REPO = "coopai-group/training-java-monolith-refactor";
const CONNECTED = ["slack", "jira", "confluence", "teams"] as const;
const N5_COMPOUND_ASK =
  "Pager: Where is date math implemented — DateTimeUtils, reports.jsp — and did we already decide not to mix this into the SQL-injection PR?";

test("interpreter handoff retains independent write and rejection criteria", () => {
  const jobs = mergeInterpreterJobs(
    [{ capability: "locate", verb: "search", terms: ["state"] }],
    [
      { capability: "locate", verb: "search", terms: ["state"], evidenceClass: "write-site", searchCriteria: ["state_id ="] },
      { capability: "locate", verb: "search", terms: [], evidenceClass: "write-reject", searchCriteria: ["ValidationError state"] }
    ],
    { message: "Where does state get updated and rejected?" }
  );
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map(job => [job.evidenceClass, job.searchCriteria]), [
    ["write-site", ["state_id ="]], ["write-reject", ["ValidationError state"]]
  ]);
});

function slackQueries(plan: ReturnType<typeof planChatFrontDoorFromRules>): string[] {
  return extraTermsForIntegration(plan.jobs, "slack") ?? [];
}

test("shouldInterpretChatAsk is true for slash/integration unless skip is set", () => {
  assert.equal(shouldInterpretChatAsk({}), true);
  assert.equal(shouldInterpretChatAsk({ integrationProvider: "slack" }), true);
  assert.equal(shouldInterpretChatAsk({ sourceHint: "Prioritize Slack" }), true);
  assert.equal(shouldInterpretChatAsk({ quickAction: "blast-radius" }), true);
  assert.equal(shouldInterpretChatAsk({ composerMode: "edit" }), true);
  assert.equal(shouldInterpretChatAsk({ skipChatIntentPlanner: true }), false);
});

test("/slack SQL-injection ask searches SQL injection, not the repo slug or whole sentence", () => {
  const turn = planRawChatAskFromRules(SLACK_SQL_INJECTION_SLASH_ASK, {
    connectedTools: [...CONNECTED],
    useRepo: USE_REPO
  });

  assert.equal(turn.constraint.kind, "integration");
  if (turn.constraint.kind !== "integration") {
    return;
  }
  assert.equal(turn.constraint.provider, "slack");
  assert.equal(turn.plan.tools.includes("slack"), true);
  assert.equal(turn.plan.tools.includes("jira"), false);
  assert.equal(turn.plan.tools.includes("teams"), false);
  assert.equal(
    (turn.plan.jobs ?? []).some((job) => job.capability === "locate"),
    false,
    "/slack must not hunt the repo"
  );
  assert.equal(
    (turn.plan.jobs ?? []).some((job) => job.capability === "decision"),
    true
  );

  const first = turn.toolQueries.slack?.[0];
  assert.equal(first, "SQL injection");
  assert.equal(jobScopedActivityQuery(slackQueries(turn.plan)), "SQL injection");

  const blob = JSON.stringify(turn.plan).toLowerCase();
  assert.equal(blob.includes("training-java-monolith-refactor"), false);
  assert.equal(blob.includes(SLACK_SQL_INJECTION_SLASH_ASK.toLowerCase()), false);
  assert.ok(!(turn.toolQueries.slack ?? []).some((query) => /training-java-monolith-refactor/i.test(query)));
  assert.ok(
    !(turn.toolQueries.slack ?? []).some(
      (query) => query.includes("What did") || query.includes("#epd")
    )
  );
});

test("not mixing still plans a decision job even though MIX_PHRASES miss the gerund", () => {
  const turn = planRawChatAskFromRules(SLACK_SQL_INJECTION_SLASH_ASK, {
    connectedTools: [...CONNECTED],
    useRepo: USE_REPO
  });
  const decision = (turn.plan.jobs ?? []).find((job) => job.capability === "decision");
  assert.ok(decision, "decision job dropped because 'not mixing' missed MIX_PHRASES");
  assert.ok(
    decision?.terms.some((term) => /sql-injection|sql injection/i.test(term)),
    `decision terms were ${decision?.terms.join("|")}`
  );
});

test("model may name the mixing topic the regex list missed", async () => {
  const interpretMessage =
    "What did #epd say about not mixing date math into the SQL-injection PR?";
  const plan = await planChatFrontDoor(
    {
      message: interpretMessage,
      connectedTools: ["slack", "jira"],
      constraint: { kind: "integration", provider: "slack" },
      useRepo: USE_REPO
    },
    {
      complete: async () =>
        JSON.stringify({
          workflow: "none",
          tools: ["slack"],
          confidence: "high",
          jobs: [{ capability: "decision", terms: ["SQL injection", "not mixing"] }]
        })
    }
  );
  const terms = extraTermsForIntegration(plan.jobs, "slack") ?? [];
  assert.ok(terms.some((term) => /sql injection/i.test(term)));
  assert.ok(terms.some((term) => /mix/i.test(term)));
  assert.equal(plan.tools.includes("slack"), true);
  assert.equal(plan.tools.includes("jira"), false);
});

test("plain compound ask still splits locate vs decision with distinct terms", () => {
  const turn = planRawChatAskFromRules(N5_COMPOUND_ASK, {
    connectedTools: [...CONNECTED],
    activeFile: "web/reports.jsp",
    useRepo: USE_REPO
  });
  assert.equal(turn.constraint.kind, "none");
  const capabilities = (turn.plan.jobs ?? []).map((job) => job.capability);
  assert.ok(capabilities.includes("locate"));
  assert.ok(capabilities.includes("decision"));
  const locate = (turn.plan.jobs ?? []).find((job) => job.capability === "locate")?.terms ?? [];
  const decision = extraTermsForIntegration(turn.plan.jobs, "slack") ?? [];
  assert.ok(locate.some((term) => /date/i.test(term) && /math/i.test(term)));
  assert.ok(decision.some((term) => /sql-injection|sql injection/i.test(term)));
  assert.equal(
    decision.some((term) => /date math/i.test(term) || term.toLowerCase() === "datetimeutils"),
    false
  );
  assert.equal(
    JSON.stringify(turn.plan).toLowerCase().includes("pager"),
    false
  );
});

test("rules-only front door preserves both evidence needs for compound reject hunts", () => {
  const ask =
    "Users can't move a work item out of backlog — the API returns an error. I don't have this repo cloned. Where is work-item state written, and what rejects a bad transition?";
  const plan = planChatFrontDoorFromRules({ message: ask, connectedTools: [] });
  const locate = (plan.jobs ?? []).filter((job) => job.capability === "locate");

  assert.ok(locate.some((job) => job.evidenceClass === "write-site"));
  assert.ok(locate.some((job) => job.evidenceClass === "write-reject"));
  const writeSite = locate.find((job) => job.evidenceClass === "write-site");
  const writeReject = locate.find((job) => job.evidenceClass === "write-reject");
  assert.ok(writeSite?.searchCriteria?.includes("state assignment"));
  assert.ok(writeReject?.searchCriteria?.includes("state validation"));
  assert.ok(writeReject?.searchCriteria?.includes("invalid state transition"));
  const brief = formatIntentBriefForAgent({ jobs: locate });
  assert.match(brief ?? "", /evidence=write-site/);
  assert.match(brief ?? "", /evidence=write-reject/);

  const calm = planChatFrontDoorFromRules({
    message: "Where do work-item states live in the backend?",
    connectedTools: []
  });
  assert.equal(
    (calm.jobs ?? []).some((job) => job.evidenceClass === "write-site" || job.evidenceClass === "write-reject"),
    false,
    "calm model-location asks must not be promoted to reject hunts"
  );
});

test("I3 compound ask splits requireAuth locate from peel-auth decision, slack+jira only", () => {
  const turn = planRawChatAskFromRules(
    "Where is requireAuth defined, and what did we already decide about peeling auth into coop-backend?",
    {
      connectedTools: [...CONNECTED, "notion", "google-docs"],
      useRepo: USE_REPO
    }
  );
  assert.equal(turn.constraint.kind, "none");
  const capabilities = (turn.plan.jobs ?? []).map((job) => job.capability);
  assert.ok(capabilities.includes("locate"));
  assert.ok(capabilities.includes("decision"));
  const locate = (turn.plan.jobs ?? []).find((job) => job.capability === "locate")?.terms ?? [];
  const decision = extraTermsForIntegration(turn.plan.jobs, "slack") ?? [];
  const decisionBlob = decision.join(" ").toLowerCase();
  assert.ok(locate.some((term) => /requireAuth/i.test(term)));
  assert.match(decisionBlob, /peel/);
  assert.match(decisionBlob, /coop-backend|coop backend/);
  assert.equal(decision.some((term) => /requireAuth/i.test(term)), false);
  assert.ok(turn.plan.tools.includes("slack") && turn.plan.tools.includes("jira"));
  assert.equal(turn.plan.tools.includes("confluence"), false);
  assert.equal(turn.plan.tools.includes("notion"), false);
  assert.equal(turn.plan.tools.includes("google-docs"), false);
});

test("bare /slack may use the repo (no topic)", () => {
  const turn = planRawChatAskFromRules("/slack", {
    connectedTools: [...CONNECTED],
    useRepo: USE_REPO
  });
  assert.equal(turn.constraint.kind, "integration");
  assert.equal(hasAskTopic(turn.interpretMessage, USE_REPO), false);
  assert.deepEqual(turn.plan.jobs ?? [], []);
  assert.equal(turn.toolQueries.slack, undefined);
});

test("/blast still runs blast; focus text is interpreted", () => {
  const bare = planRawChatAskFromRules("/blast", {
    connectedTools: [...CONNECTED],
    useRepo: USE_REPO
  });
  assert.equal(bare.constraint.kind, "workflow");
  if (bare.constraint.kind === "workflow") {
    assert.equal(bare.constraint.workflow, "blast-radius");
  }
  assert.equal(bare.plan.workflow, "blast-radius");
  assert.equal(bare.plan.execution, "silent");
  assert.equal(bare.plan.mode, "run-workflow");

  const focused = planRawChatAskFromRules("/blast SQL-injection date math", {
    connectedTools: [...CONNECTED],
    useRepo: USE_REPO
  });
  assert.equal(focused.plan.workflow, "blast-radius");
  assert.ok(
    JSON.stringify(focused.plan.jobs ?? []).toLowerCase().includes("sql-injection") ||
      focused.interpretMessage.toLowerCase().includes("sql-injection")
  );
});

test("unconstrained blast-shaped English is not a workflow constraint", () => {
  const turn = planRawChatAskFromRules("What files are impacted if I change this handler?", {
    connectedTools: [...CONNECTED],
    activeFile: "src/chat/handler.ts",
    useRepo: USE_REPO
  });
  assert.equal(turn.constraint.kind, "none");
  assert.equal(turn.plan.workflow, undefined);
  assert.notEqual(turn.plan.execution, "silent");
  assert.notEqual(turn.plan.mode, "run-workflow");
  assert.notEqual(turn.plan.mode, "suggest-chips");
});

test("Teams is omitted while TEAMS_COMING_SOON", () => {
  assert.equal(TEAMS_COMING_SOON, true);
  const turn = planRawChatAskFromRules(SLACK_SQL_INJECTION_SLASH_ASK, {
    connectedTools: ["slack", "jira", "teams"],
    useRepo: USE_REPO
  });
  assert.equal(turn.plan.tools.includes("teams"), false);
  const teamsAsk = planRawChatAskFromRules("/teams What did we decide about SQL-injection?", {
    connectedTools: ["teams", "slack"],
    useRepo: USE_REPO
  });
  assert.equal(teamsAsk.plan.tools.includes("teams"), false);
});

test("fail-open does not search the repo slug when a topic exists", () => {
  const plan = planChatFrontDoorFromRules({
    message: "What did #epd say about not mixing date math into the SQL-injection PR?",
    connectedTools: ["slack"],
    constraint: { kind: "integration", provider: "slack" },
    useRepo: USE_REPO
  });
  const terms = extraTermsForIntegration(plan.jobs, "slack") ?? [];
  assert.ok(terms.length > 0);
  assert.equal(
    terms.some((term) => /training-java-monolith-refactor/i.test(term)),
    false
  );
});

test("model JSON can write job terms; whole-sentence terms are rejected later by merge", () => {
  const plan = parseChatIntentPlanResponse(
    JSON.stringify({
      workflow: "none",
      tools: ["slack"],
      confidence: "high",
      jobs: [{ capability: "decision", terms: ["SQL injection"] }]
    }),
    ["slack"],
    "What did #epd say about not mixing date math into the SQL-injection PR?"
  );
  assert.equal(plan.mode, "tools-only");
  assert.deepEqual(plan.jobs, [{ capability: "decision", verb: "search", terms: ["SQL injection"] }]);
});

test("N5 locate+decision plans call quarterback refine without a command constraint", () => {
  const plan = planChatFrontDoorFromRules({
    message: N5_COMPOUND_ASK,
    activeFile: "web/reports.jsp",
    connectedTools: ["slack", "jira"]
  });
  assert.equal(shouldCallChatIntentModel(plan), true);
  assert.equal(
    shouldCallChatIntentModel(plan, {
      constraint: { kind: "integration", provider: "slack" },
      message: "What did #epd say about not mixing date math into the SQL-injection PR?"
    }),
    true
  );
});

test("handleChatSend interprets before routeSlashCommand (slash bypass is impossible)", async () => {
  createRequire(__filename)("../../../scripts/vscode-test-stub.cjs");
  const { CoopChatSession } = await import("../CoopChatSession");
  for (const ask of ["/slack SQL injection", "/blast auth", "/edit Rename header", "/compare org/one org/two auth"]) {
    const events: string[] = [];
    const plan = planRawChatAskFromRules(ask).plan;
    const session = Object.assign(Object.create(CoopChatSession.prototype), {
      currentContext: { provider: "gitlab", owner: "org", repo: "one", branch: "main", scope: "repo" },
      options: { api: { beginQuotaTurn() {} } },
      threadRuns: new ThreadRunManager(),
      dismissPendingQuickActionSuggest() { events.push("dismiss"); },
      async resolveChatIntentPlan() { events.push("interpret"); return plan; },
      async routeSlashCommand(_parsed: unknown, _attachments: unknown, _mentions: unknown, routedPlan: unknown, submissionId: unknown, requestStartedAt: unknown) {
        events.push("route");
        assert.equal(routedPlan, plan, ask);
        assert.equal(submissionId, "submission", ask);
        assert.equal(requestStartedAt, 12345, "the interpreter must not reset the submission budget");
      }
    });
    await session.handleChatSend(ask, undefined, undefined, { clientSubmissionId: "submission", requestStartedAt: 12345 });
    assert.deepEqual(events, ["dismiss", "interpret", "route"], ask);
  }
  const sessionPath = path.join(__dirname, "../CoopChatSession.ts");
  const src = fs.readFileSync(sessionPath, "utf8");
  assert.equal(
    src.includes("Slash and explicit integrationProvider remain the override"),
    false,
    "slash override comment returned"
  );
  assert.match(src, /shouldInterpretChatAsk/);
  assert.match(src, /resolveChatCommandConstraint/);
  assert.match(src, /frontDoorInterpretText/);
  assert.match(src, /useCase:\s*FRONT_DOOR_INTERPRETER_USE_CASE/);
  assert.doesNotMatch(
    src,
    /if \(parsed\) \{\s*await this\.routeSlashCommand\(parsed, attachments, options\?\.mentions\);\s*return;/
  );
  assert.match(
    src,
    /currentContext\.owner\?\.trim\(\) \|\| this\.preferences\.owner/,
    "Use-repo chip must win over Settings when resolving useRepo"
  );
  assert.doesNotMatch(
    src,
    /decision\.kind === "silent-workflow"/,
    "plain chat must not silently re-enter a quick action"
  );
  assert.doesNotMatch(
    src,
    /await this\.completeQuickActionSuggestClarification\(/,
    "plain chat must not interrupt with Want Blast chips"
  );
});

test("integration document slash commands reach interpretation without a selected repo", async () => {
  createRequire(__filename)("../../../scripts/vscode-test-stub.cjs");
  const { CoopChatSession } = await import("../CoopChatSession");
  for (const ask of ["/docs Read Coop AI — Architecture Overview", "/notion Read Architecture Overview", "/confluence Read Architecture Overview"]) {
    const events: string[] = [];
    const plan = planRawChatAskFromRules(ask).plan;
    const session = Object.assign(Object.create(CoopChatSession.prototype), {
      currentContext: {}, options: { api: { beginQuotaTurn() {} } },
      threadRuns: new ThreadRunManager(),
      dismissPendingQuickActionSuggest() {},
      async completeMissingIntentClarification() { events.push("blocked"); },
      async resolveChatIntentPlan() { events.push("interpret"); return plan; },
      async routeSlashCommand() { events.push("route"); }
    });
    await session.handleChatSend(ask);
    assert.deepEqual(events, ["interpret", "route"], ask);
  }
});

test("Stop during intent planning prevents late slash execution and permits the next send", async () => {
  createRequire(__filename)("../../../scripts/vscode-test-stub.cjs");
  const { CoopChatSession } = await import("../CoopChatSession");
  const ask = "/edit Rename the accumulator";
  const plan = planRawChatAskFromRules(ask).plan;
  let resolvePlan!: (value: typeof plan) => void;
  const pendingPlan = new Promise<typeof plan>((resolve) => { resolvePlan = resolve; });
  const routes: string[] = [];
  const diagnostics: Array<Record<string, unknown>> = [];
  let first = true;
  const session = Object.assign(Object.create(CoopChatSession.prototype), {
    currentContext: { provider: "gitlab", owner: "org", repo: "one", branch: "main", scope: "repo" },
    options: { api: { beginQuotaTurn() {} } },
    threadRuns: new ThreadRunManager(),
    dismissPendingQuickActionSuggest() {},
    resolveChatIntentPlan() { if (first) { first = false; return pendingPlan; } return Promise.resolve(plan); },
    async routeSlashCommand() { routes.push("route"); },
    logAgentDiagnostic(_threadId: string, event: Record<string, unknown>) { diagnostics.push(event); },
    clearIntentFeedback() {},
    postForThread() {},
    pushThreadsList() {}
  });
  const pending = session.handleChatSend(ask);
  session.handleStreamCancel(SESSION_RUN_THREAD_ID);
  assert.equal(diagnostics[0]?.stage, "user-stop");
  assert.equal(diagnostics[0]?.registeredTurn, false);
  assert.equal(diagnostics[0]?.hadPartial, false);
  assert.equal(diagnostics[0]?.content, undefined, "Stop diagnostics must not include source or answer text");
  resolvePlan(plan);
  await pending;
  assert.deepEqual(routes, [], "a stopped planner must never start the edit afterward");
  await session.handleChatSend(ask);
  assert.deepEqual(routes, ["route"], "Stop must not suppress the next submission");
});

const RECENCY_SLASHES: Array<{ ask: string; provider: "slack" | "jira" | "google-docs" | "confluence" | "notion" }> = [
  { ask: "/slack search for the most recent post", provider: "slack" },
  { ask: "/jira latest tickets", provider: "jira" },
  { ask: "/docs most recent document", provider: "google-docs" },
  { ask: "/confluence latest pages", provider: "confluence" },
  { ask: "/notion most recent", provider: "notion" }
];

const ALL_CONNECTED = ["slack", "jira", "confluence", "notion", "google-docs"] as const;

test("recency-only slashes assign latest with no repo-slug query", () => {
  for (const row of RECENCY_SLASHES) {
    const turn = planRawChatAskFromRules(row.ask, {
      connectedTools: [...ALL_CONNECTED],
      useRepo: USE_REPO
    });
    assert.equal(turn.constraint.kind, "integration", row.ask);
    assert.equal(jobVerbForIntegration(turn.plan.jobs, row.provider), "latest", row.ask);
    assert.deepEqual(extraTermsForIntegration(turn.plan.jobs, row.provider), [], row.ask);
    assert.deepEqual(turn.toolQueries[row.provider], ["latest"], row.ask);
    assert.equal(
      JSON.stringify(turn.plan).toLowerCase().includes("training-java-monolith-refactor"),
      false,
      row.ask
    );
  }
});

test("topic still wins over recency words", () => {
  const slash = planRawChatAskFromRules(SLACK_SQL_INJECTION_SLASH_ASK, {
    connectedTools: [...ALL_CONNECTED],
    useRepo: USE_REPO
  });
  assert.equal(jobVerbForIntegration(slash.plan.jobs, "slack"), "search");
  assert.equal(slash.toolQueries.slack?.[0], "SQL injection");

  const jira = planRawChatAskFromRules("/jira COOP-101", {
    connectedTools: [...ALL_CONNECTED],
    useRepo: USE_REPO
  });
  assert.equal(jobVerbForIntegration(jira.plan.jobs, "jira"), "search");
  assert.ok(
    extraTermsForIntegration(jira.plan.jobs, "jira")?.some((term) => /COOP-101/i.test(term)),
    `jira terms were ${extraTermsForIntegration(jira.plan.jobs, "jira")?.join("|")}`
  );

  const plain = planRawChatAskFromRules("latest SQL-injection discussion in Slack", {
    connectedTools: [...ALL_CONNECTED],
    useRepo: USE_REPO
  });
  assert.equal(jobVerbForIntegration(plain.plan.jobs, "slack"), "search");
  assert.equal(plain.toolQueries.slack?.[0], "SQL injection");
  assert.notEqual(plain.toolQueries.slack?.[0], "latest");
});

test("bare integration slashes still allow repo fallback", () => {
  for (const ask of ["/slack", "/jira", "/docs"]) {
    const turn = planRawChatAskFromRules(ask, {
      connectedTools: [...ALL_CONNECTED],
      useRepo: USE_REPO
    });
    assert.equal(hasAskTopic(turn.interpretMessage, USE_REPO), false, ask);
    assert.deepEqual(turn.plan.jobs ?? [], [], ask);
  }
});

test("Use-repo set with no Settings still plans latest and search", () => {
  const latest = planRawChatAskFromRules("/slack search for the most recent post", {
    connectedTools: ["slack"],
    useRepo: "acme/plane"
  });
  assert.equal(jobVerbForIntegration(latest.plan.jobs, "slack"), "latest");
  const search = planRawChatAskFromRules("/slack SQL-injection", {
    connectedTools: ["slack"],
    useRepo: "acme/plane"
  });
  assert.equal(jobVerbForIntegration(search.plan.jobs, "slack"), "search");
  assert.equal(search.toolQueries.slack?.[0], "SQL injection");
});
