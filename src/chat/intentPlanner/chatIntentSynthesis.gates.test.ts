import assert from "node:assert/strict";
import test from "node:test";
import { enrichChatResponseForAction } from "../chatResponseEnrichment";
import { resolvePlainChatSynthesisRoute } from "../synthesisRouting";
import { planChatIntentFromRules } from "./planChatIntent";
import {
  buildMultiToolPlainChatUserPrompt,
  enrichIntentJobResponse
} from "../../prompts/multiToolPlainChatSynthesis";
import {
  buildIncidentReconstructionUserPrompt,
  enrichIncidentReconstructionResponse,
  incidentIntegrationsFromBundle
} from "../../prompts/incidentReconstruction";
import { extraTermsForIntegration } from "./planChatJobs";
import { shouldRunAgentToolLoop } from "../agentRouting";
import { systemPromptForUseCase } from "../../prompts/systemPrompts";

const N5_COMPOUND_ASK =
  "Pager: Where is date math implemented — DateTimeUtils, reports.jsp — and did we already decide not to mix this into the SQL-injection PR?";
const A9_ASK =
  "Last week’s webhook delivery failures — what Jira tickets and Slack threads are related, which code paths handle retries/monitoring, and what’s still open?";
const I4_TICKET_PICKUP_ASK =
  "I'm covering COOP-101 this week — peel auth into coop-backend. What in this repo still owns requireAuth, and what's the safest first extraction so we don't break every VS Code session?";

test("N5 plans locate+decision, selects intent-job contract, and stays evidence-safe", () => {
  const plan = planChatIntentFromRules({
    message: N5_COMPOUND_ASK,
    activeFile: "web/reports.jsp",
    connectedTools: ["jira", "slack"]
  });
  assert.deepEqual(
    (plan.jobs ?? []).map((job) => job.capability),
    ["locate", "decision"]
  );

  const route = resolvePlainChatSynthesisRoute({
    userQuestion: N5_COMPOUND_ASK,
    fetchIntegrations: plan.tools,
    intentPlan: plan
  });
  assert.equal(route.kind, "intent-job");
  assert.equal(route.useCase, "intent_job");
  if (route.kind !== "intent-job") {
    return;
  }

  const integrations = {
    jira: { issues: [{ key: "SEC-9", summary: "Keep date math out of SQL fix" }] },
    slack: undefined
  };
  const userPrompt = buildMultiToolPlainChatUserPrompt({
    userQuestion: N5_COMPOUND_ASK,
    file: "web/reports.jsp",
    tools: route.tools,
    jobs: plan.jobs,
    integrations,
    connected: { jira: true, slack: false }
  });
  const systemPrompt = systemPromptForUseCase(route.useCase);
  assert.match(systemPrompt, /Locate claims require attached remote code bodies/);
  assert.match(systemPrompt, /Decision claims require attached integration or code-host evidence/);
  assert.match(systemPrompt, /no mention of the decision topic/i);
  assert.doesNotMatch(
    systemPrompt,
    /\*\*Reviewer checks\*\* \(if|## Concrete file edits|## Patch output format|\*\*How the open file fits\*\*/
  );
  assert.doesNotMatch(userPrompt, /Symptoms|Code paths|incident \/ on-call/);

  const enriched = enrichIntentJobResponse(
    `**Answer**
The decision is recorded in SEC-9.

**Sources**
- [Sources: Jira search] — SEC-9 records the scope decision.
- [Sources: Slack search] — Slack confirmed it.

Run git grep locally or use Find in Path for the implementation.`,
    { tools: route.tools, integrations }
  );
  assert.match(enriched, /SEC-9/);
  assert.doesNotMatch(enriched, /Slack search|git grep|Find in Path/i);
  assert.doesNotMatch(enriched, /\*\*Symptoms\*\*|\*\*Integrations\*\*/);

  const heading = enrichIntentJobResponse(`**Summary**\nDate math is in DateTimeUtils.`, {
    tools: route.tools,
    integrations,
    jobs: [
      { capability: "locate", terms: ["date math"] },
      { capability: "decision", terms: ["SQL-injection"] }
    ],
    codePaths: ["src/main/java/com/sourcegraph/demo/bigbadmonolith/util/DateTimeUtils.java"]
  });
  assert.match(heading, /Date math is in DateTimeUtils/);
  assert.doesNotMatch(heading, /\*\*Answer\*\*|\*\*Summary\*\*/);
});

test("N5 with no source body and timed-out integrations gets a deterministic safe answer", () => {
  const integrations = {
    jira: { error: "Search timed out before context gathering ended." },
    slack: { error: "Search timed out before context gathering ended." }
  };
  const enriched = enrichIntentJobResponse(
    `**Summary**
Look in src/main/java/example/util and run rg "DateTime" locally.

**Sources**
- [Sources: Jira search]`,
    {
      tools: ["jira", "slack"],
      jobs: [
        { capability: "locate", terms: ["date math"] },
        { capability: "decision", terms: ["SQL-injection"] }
      ],
      integrations,
      codePaths: []
    }
  );
  assert.match(enriched, /\*\*Code location\*\*/);
  assert.match(enriched, /remote code search did not return a usable implementation file/i);
  assert.match(enriched, /Jira: error — Search timed out/i);
  assert.doesNotMatch(enriched, /src\/main|run rg|Sources: Jira/i);
});

test("locate-only and code-host jobs still use the evidence-safe writer", () => {
  for (const plan of [
    planChatIntentFromRules({
      message: "Where is requireAuth implemented?",
      connectedTools: []
    }),
    planChatIntentFromRules({
      message: "List GitLab merge requests about authentication",
      connectedTools: []
    })
  ]) {
    assert.ok((plan.jobs?.length ?? 0) > 0);
    assert.equal(
      resolvePlainChatSynthesisRoute({
        userQuestion: plan.focus,
        intentPlan: plan
      }).kind,
      "intent-job"
    );
  }
});

test("A9 plans through one incident route and enriches only attached evidence", () => {
  const plan = planChatIntentFromRules({
    message: A9_ASK,
    activeFile: "apps/api/plane/bgtasks/webhook_task.py",
    connectedTools: ["jira", "slack"]
  });
  const route = resolvePlainChatSynthesisRoute({
    userQuestion: A9_ASK,
    fetchIntegrations: plan.tools,
    intentPlan: plan
  });
  assert.equal(route.kind, "incident");

  const bundle = [
    {
      data: {
        jiraSearch: { issues: [{ key: "PLN-812", summary: "Webhook outage retries" }] },
        slackSearch: {
          messages: [{ channelName: "incidents", text: "Webhook delivery outage is retrying" }]
        },
        localFiles: {
          files: [
            {
              path: "apps/api/plane/bgtasks/webhook_task.py",
              content: "def retry_webhook():\n    pass"
            }
          ]
        }
      }
    }
  ];
  const integrations = incidentIntegrationsFromBundle(bundle, {
    jiraConnected: true,
    slackConnected: true
  });
  const prompt = buildIncidentReconstructionUserPrompt({
    userQuestion: A9_ASK,
    file: "apps/api/plane/bgtasks/webhook_task.py",
    integrations
  });
  assert.equal(
    prompt.match(/## Required response structure \(incident \/ on-call\)/g)?.length,
    1
  );
  assert.match(prompt, /PLN-812/);
  assert.match(prompt, /#incidents/);

  const enriched = enrichChatResponseForAction({
    content: "**Answer**\nWebhook delivery failed and retried.",
    contextBundle: bundle,
    incidentReconstruction: {
      ...integrations,
      codePaths: ["apps/api/plane/bgtasks/webhook_task.py"]
    }
  });
  assert.match(enriched, /\*\*Code paths\*\*/);
  assert.match(enriched, /webhook_task\.py/);
  assert.match(enriched, /PLN-812|Jira: 1 issue/);
  assert.match(enriched, /Slack: 1 thread/);
  assert.equal((enriched.match(/\*\*Integrations\*\*/g) ?? []).length, 1);

  const noCode = enrichIncidentReconstructionResponse("**Answer**\nOutage reported.", integrations);
  assert.doesNotMatch(noCode, /See attached file and code evidence|concrete code body attached/);
});

test("I4 ticket pickup plans locate+decision, not incident reconstruction", () => {
  const plan = planChatIntentFromRules({
    message: I4_TICKET_PICKUP_ASK,
    connectedTools: ["jira", "slack"]
  });
  const capabilities = (plan.jobs ?? []).map((job) => job.capability);
  assert.ok(capabilities.includes("locate"));
  assert.ok(capabilities.includes("decision"));
  assert.equal(plan.codeIntent?.action, "locate");

  const route = resolvePlainChatSynthesisRoute({
    userQuestion: I4_TICKET_PICKUP_ASK,
    fetchIntegrations: plan.tools,
    intentPlan: plan
  });
  assert.equal(route.kind, "intent-job");
  assert.notEqual(route.kind, "incident");

  const jiraTerms = (extraTermsForIntegration(plan.jobs, "jira") ?? []).map((term) =>
    term.toLowerCase()
  );
  assert.ok(
    jiraTerms.some((term) => /coop-101/i.test(term)),
    `jira terms: ${jiraTerms.join("|")}`
  );
  assert.ok(
    jiraTerms.some((term) => /peel|auth|coop-backend/i.test(term)),
    `jira terms: ${jiraTerms.join("|")}`
  );
  assert.equal(
    jiraTerms.some(
      (term) =>
        term.includes("this week") ||
        term.includes("covering") ||
        term.split(/\s+/).length > 8
    ),
    false,
    `jira terms leaked the user sentence: ${jiraTerms.join("|")}`
  );

  assert.equal(
    shouldRunAgentToolLoop({
      query: I4_TICKET_PICKUP_ASK,
      hasQuickAction: false,
      intentPlan: plan
    }),
    true
  );

  const systemPrompt = systemPromptForUseCase(route.useCase);
  assert.doesNotMatch(systemPrompt, /Required response structure \(incident/);
  assert.match(systemPrompt, /No mention in Slack of peel-auth \/ COOP-101/);

  const userPrompt = buildMultiToolPlainChatUserPrompt({
    userQuestion: I4_TICKET_PICKUP_ASK,
    tools: ["jira", "slack"],
    jobs: plan.jobs,
    integrations: {
      jira: { issues: [{ key: "COOP-101", summary: "Peel auth into coop-backend" }] },
      slack: { messages: [] }
    },
    connected: { jira: true, slack: true }
  });
  assert.doesNotMatch(userPrompt, /Symptoms|Code paths|incident \/ on-call/);
  assert.match(userPrompt, /No mention in Slack of /);
  assert.doesNotMatch(userPrompt, /Slack search returned zero hits/i);
  assert.doesNotMatch(userPrompt, /index is stale|If you want I can run/);
});

test("I3/I4 intern-speak bubbles rewrite through the chat funnel", () => {
  const intern =
    "Slack search returned zero hits for `coop backend`. The index returned no usable matches for `requireAuth`.";
  const enriched = enrichChatResponseForAction({ content: intern });
  assert.match(enriched, /No mention in Slack of coop backend/i);
  assert.match(enriched, /I couldn't find requireAuth in this repo/i);
  assert.doesNotMatch(enriched, /zero hits for|index returned no usable/i);

  const locked = "requireAuth lives in src/server/authMiddleware.ts.";
  assert.equal(enrichChatResponseForAction({ content: locked }), locked);
});
