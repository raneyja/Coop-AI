import assert from "node:assert/strict";
import {
  isRepoInvestigationQuery,
  jobsGuaranteeLocatePrefetch,
  plannerAllowsAgentRepoLoop,
  shouldRunAgentToolLoop,
  agentTurnAllowsRepoTools,
  shouldSkipAgentHuntForOpenFileFeatureAdd,
  shouldSuppressSuggestChipsForAgentHunt,
  integrationsForAgentLoop
} from "./agentRouting";
import { emptyChatIntentPlan, type ChatIntentPlan } from "./intentPlanner/types";
import { planChatIntentFromRules } from "./intentPlanner/planChatIntent";
import { DOGFOOD_HUNT_QUESTION } from "../api/agent/dogfoodContract";

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

test("shouldRunAgentToolLoop is false for quick actions", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "blast radius",
      hasQuickAction: true
    }),
    false
  );
});

test("shouldRunAgentToolLoop is false for local explain even on a hunt-shaped leftover (A-P8)", () => {
  const plan: ChatIntentPlan = {
    ...emptyChatIntentPlan("Explain this function"),
    mode: "plain",
    execution: "none",
    confidence: "high"
  };
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Explain this function",
      hasQuickAction: false,
      intentPlan: plan
    }),
    false
  );
});

test("Explain requireAuth in this file + activeFile keeps the loop off", () => {
  const query =
    "Explain requireAuth in this file. When does it let an unauthenticated request through?";
  const plan = planChatIntentFromRules({
    message: query,
    activeFile: "src/server/authMiddleware.ts",
    connectedTools: ["jira", "slack", "confluence"]
  });
  assert.equal(plan.mode, "plain");
  assert.deepEqual(plan.tools, []);
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: plan
    }),
    false
  );
  assert.equal(plannerAllowsAgentRepoLoop(plan, query), false);
});

test("shouldRunAgentToolLoop is true for hunt + Slack compound ask without jobs (fail-open)", () => {
  const query = "Where is requireAuth defined, and what did Slack say about the auth change?";
  const plan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["slack"],
    confidence: "high",
    focus: query,
    execution: "none",
    codeIntent: { action: "locate", confidence: "high", reason: "asks where something is and names code" }
  };
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: plan
    }),
    true
  );
});

test("shouldRunAgentToolLoop is true when locate+decision jobs are planned", () => {
  const query = "Where is requireAuth defined, and what did Slack say about the auth change?";
  const plan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["slack"],
    jobs: [
      { capability: "locate", terms: ["requireAuth"] },
      { capability: "decision", terms: ["auth change"] }
    ],
    confidence: "high",
    focus: query,
    execution: "none",
    codeIntent: { action: "locate", confidence: "high", reason: "asks where something is and names code" }
  };
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: plan
    }),
    true
  );
  assert.equal(jobsGuaranteeLocatePrefetch(plan.jobs), true);
});

test("I3 compound locate+decision enters the agent loop; slash still loops without a hunt", () => {
  const query =
    "Where is requireAuth defined, and what did we already decide about peeling auth into coop-backend?";
  const plan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["slack", "jira"],
    jobs: [
      { capability: "locate", terms: ["requireAuth"] },
      { capability: "decision", terms: ["peeling auth", "coop-backend"] }
    ],
    confidence: "high",
    focus: query,
    execution: "none",
    codeIntent: { action: "locate", confidence: "high", reason: "asks where something is and names code" }
  };
  assert.equal(jobsGuaranteeLocatePrefetch(plan.jobs), true);
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: plan
    }),
    true
  );
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: plan,
      integrationSlash: true
    }),
    true
  );
});

test("shouldRunAgentToolLoop is true for Slack-named ask without a repo hunt (A-P9)", () => {
  const plan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["slack"],
    confidence: "high",
    focus: "What's in Slack about this?",
    execution: "none"
  };
  assert.equal(
    shouldRunAgentToolLoop({
      query: "What's in Slack about this?",
      hasQuickAction: false,
      intentPlan: plan
    }),
    true
  );
  assert.equal(agentTurnAllowsRepoTools({ intentPlan: plan }), false);
});

test("named Notion docs ask starts the vendor loop and does not unlock Jira", () => {
  const query =
    "Look in Notion — what does the Architecture Overview say about extracting auth into coop-backend?";
  const plan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["notion"],
    jobs: [{ capability: "docs", terms: ["Architecture Overview", "coop-backend"] }],
    confidence: "high",
    focus: query,
    execution: "none"
  };
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: plan
    }),
    true
  );
  assert.equal(agentTurnAllowsRepoTools({ intentPlan: plan }), false);
  assert.deepEqual(
    integrationsForAgentLoop({
      connected: ["notion", "jira", "slack", "confluence"],
      plan
    }),
    ["notion"]
  );
});

test("code-only locate does not unlock connected vendors", () => {
  const query = "Where is auth middleware enforced and what calls it?";
  const connected: Array<"jira" | "slack" | "confluence" | "notion"> = [
    "jira",
    "slack",
    "confluence",
    "notion"
  ];
  assert.deepEqual(
    integrationsForAgentLoop({
      connected,
      plan: emptyChatIntentPlan(query)
    }),
    []
  );
  const planned = planChatIntentFromRules({
    message: query,
    activeFile: "src/server/authMiddleware.ts",
    connectedTools: connected
  });
  assert.notEqual(planned.mode, "plain");
  assert.deepEqual(planned.tools, []);
  assert.deepEqual(integrationsForAgentLoop({ connected, plan: planned }), []);
});

test("I3 locate+decision stays on planned jira+slack, not Confluence", () => {
  const query =
    "Where is requireAuth defined, and what did we already decide about peeling auth into coop-backend?";
  const connected = ["jira", "slack", "confluence"] as const;
  const plan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["jira", "slack"],
    jobs: [
      { capability: "locate", terms: ["requireAuth"] },
      { capability: "decision", terms: ["peeling auth", "coop-backend"] }
    ],
    confidence: "high",
    focus: query,
    execution: "none",
    codeIntent: { action: "locate", confidence: "high", reason: "asks where something is and names code" }
  };
  assert.deepEqual(
    integrationsForAgentLoop({
      connected: [...connected],
      plan
    }),
    ["jira", "slack"]
  );
  const fromRules = planChatIntentFromRules({
    message: query,
    connectedTools: [...connected]
  });
  assert.equal(fromRules.mode, "tools-only");
  assert.ok(fromRules.tools.includes("jira") && fromRules.tools.includes("slack"));
  assert.equal(fromRules.tools.includes("confluence"), false);
  assert.deepEqual(
    integrationsForAgentLoop({ connected: [...connected], plan: fromRules }).sort(),
    fromRules.tools.slice().sort()
  );
  assert.equal(
    integrationsForAgentLoop({ connected: [...connected], plan: fromRules }).includes("confluence"),
    false
  );
});

test("I30 locate+docs stays on planned Confluence", () => {
  const query = "Where is requireAuth defined, and what do the docs say about extracting auth?";
  const plan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["confluence"],
    jobs: [
      { capability: "locate", terms: ["requireAuth"] },
      { capability: "docs", terms: ["extracting auth"] }
    ],
    confidence: "high",
    focus: query,
    execution: "none",
    codeIntent: { action: "locate", confidence: "high", reason: "asks where something is and names code" }
  };
  assert.deepEqual(
    integrationsForAgentLoop({
      connected: ["jira", "slack", "confluence", "notion"],
      plan
    }),
    ["confluence"]
  );
});

test("shouldRunAgentToolLoop is true for a repo hunt (always on)", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Where is auth middleware enforced and what calls it?",
      hasQuickAction: false,
      intentPlan: emptyChatIntentPlan("Where is auth middleware enforced and what calls it?")
    }),
    true
  );
});

test("shouldRunAgentToolLoop is true for /docs slash — vendor loop, not a hunt", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "summarize auth middleware behavior",
      hasQuickAction: false,
      intentPlan: emptyChatIntentPlan("summarize auth middleware behavior"),
      integrationSlash: true
    }),
    true
  );
  assert.equal(agentTurnAllowsRepoTools({ integrationSlash: true }), false);
});

test("shouldRunAgentToolLoop is false for a file-count inventory ask", () => {
  const query = "How many files are in this repo?";
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: emptyChatIntentPlan(query)
    }),
    false
  );
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: {
        ...emptyChatIntentPlan(query),
        mode: "none",
        codeIntent: { action: "understand", confidence: "medium", reason: "asks why or how" }
      }
    }),
    false
  );
});

test("shouldRunAgentToolLoop is false for how-to and product How/Why asks", () => {
  for (const query of [
    "How do I run the tests?",
    "How old is this repo?",
    "Why is chat so slow?",
    "How is this repo organized?"
  ]) {
    assert.equal(
      shouldRunAgentToolLoop({
        query,
        hasQuickAction: false,
        intentPlan: {
          ...emptyChatIntentPlan(query),
          mode: "none",
          codeIntent: { action: "understand", confidence: "medium", reason: "asks why or how" }
        }
      }),
      false,
      query
    );
  }
});

test("shouldRunAgentToolLoop is false for thanks follow-up (UX-G7)", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "thanks",
      hasQuickAction: false,
      intentPlan: emptyChatIntentPlan("thanks")
    }),
    false
  );
});

test("shouldRunAgentToolLoop is false for /edit (UX-G8)", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "Where is auth middleware enforced and what calls it?",
      hasQuickAction: false,
      isEditTurn: true
    }),
    false
  );
});

test("plannerAllowsAgentRepoLoop allows named-file follow-ups even when the plan is plain", () => {
  const query = "Read src/server/authMiddleware.ts and show me the export.";
  assert.equal(
    plannerAllowsAgentRepoLoop(
      {
        ...emptyChatIntentPlan(query),
        mode: "plain",
        execution: "none",
        confidence: "high"
      },
      query
    ),
    true
  );
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: {
        ...emptyChatIntentPlan(query),
        mode: "plain",
        execution: "none",
        confidence: "high"
      }
    }),
    true
  );
});

test("plannerAllowsAgentRepoLoop allows rely-on / who-created file asks even when the plan is plain", () => {
  const query =
    "Give me a tl;dr of this file? What does it do, what other files rely on it, and who created it / when?";
  assert.equal(
    plannerAllowsAgentRepoLoop(
      {
        ...emptyChatIntentPlan(query),
        mode: "plain",
        execution: "none",
        confidence: "high"
      },
      query
    ),
    true
  );
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: {
        ...emptyChatIntentPlan(query),
        mode: "plain",
        execution: "none",
        confidence: "high"
      }
    }),
    true
  );
});

test("plannerAllowsAgentRepoLoop blocks workflows", () => {
  assert.equal(
    plannerAllowsAgentRepoLoop(
      {
        mode: "run-workflow",
        workflow: "trace-decision",
        tools: [],
        confidence: "high",
        focus: "trace the decision",
        execution: "silent"
      },
      "trace the decision in this file please"
    ),
    false
  );
});

test("shouldSuppressSuggestChipsForAgentHunt is true for a location hunt", () => {
  assert.equal(
    shouldSuppressSuggestChipsForAgentHunt({
      query: DOGFOOD_HUNT_QUESTION
    }),
    true
  );
});

test("shouldSuppressSuggestChipsForAgentHunt is false for thanks", () => {
  assert.equal(
    shouldSuppressSuggestChipsForAgentHunt({
      query: "thanks"
    }),
    false
  );
});

test("suggest-chips leftover plan blocks the loop; none plan after Just answer allows it", () => {
  const query = DOGFOOD_HUNT_QUESTION;
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: {
        mode: "suggest-chips",
        workflow: "find-owner",
        tools: [],
        confidence: "medium",
        focus: query,
        execution: "confirm"
      }
    }),
    false
  );
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: emptyChatIntentPlan(query)
    }),
    true
  );
});

test("isRepoInvestigationQuery requires length and hunt language", () => {
  assert.equal(isRepoInvestigationQuery("ok"), false);
  assert.equal(isRepoInvestigationQuery("Where is the session token validated across the codebase?"), true);
});

test("open-file feature-add skips the agent hunt so A10 can read the chip file", () => {
  const ask =
    "We're adding a blocked_by issue link type this sprint. Where should validation live, and which existing link types in this mapper should I mirror so we don't fork a second relation model?";
  assert.equal(
    shouldSkipAgentHuntForOpenFileFeatureAdd({
      message: ask,
      openFile: "apps/api/plane/utils/issue_relation_mapper.py"
    }),
    true
  );
  assert.equal(
    shouldSkipAgentHuntForOpenFileFeatureAdd({ message: ask, openFile: undefined }),
    false
  );
  assert.equal(
    shouldSkipAgentHuntForOpenFileFeatureAdd({
      message: "Where is APIKeyAuthentication defined in this repo?",
      openFile: "apps/api/plane/utils/issue_relation_mapper.py"
    }),
    false
  );
});

test("ticket pickup with requireAuth and Jira still runs the hunt (3b)", () => {
  const query =
    "I'm covering COOP-101 this week — peel auth into coop-backend. What in this repo still owns requireAuth, and what's the safest first extraction so we don't break every VS Code session?";
  const plan: ChatIntentPlan = {
    mode: "tools-only",
    tools: ["jira"],
    jobs: [
      { capability: "locate", terms: ["requireAuth"] },
      { capability: "decision", terms: ["COOP-101", "peel-auth"] }
    ],
    confidence: "high",
    focus: query,
    execution: "none",
    codeIntent: { action: "locate", confidence: "high", reason: "asks where something is and names code" }
  };
  assert.equal(
    shouldRunAgentToolLoop({
      query,
      hasQuickAction: false,
      intentPlan: plan
    }),
    true
  );
});

console.log(`\nagentRouting: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
