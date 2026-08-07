import assert from "node:assert/strict";
import {
  INCIDENT_SECTION_CODE_PATHS,
  INCIDENT_SECTION_GAPS,
  INCIDENT_SECTION_INTEGRATIONS,
  INCIDENT_SECTION_SYMPTOMS,
  INCIDENT_SECTION_TICKETS_THREADS,
  buildIncidentGapsBullets,
  buildIncidentReconstructionUserPrompt,
  buildIncidentTicketsThreadsBullets,
  enrichIncidentReconstructionResponse,
  incidentIntegrationsFromBundle,
  resolveIncidentIntegrationStatus
} from "./incidentReconstruction";

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

test("connected empty Jira/Slack says searched + empty (not 'no incident')", () => {
  const jira = resolveIncidentIntegrationStatus("jira", { issues: [] }, true);
  const slack = resolveIncidentIntegrationStatus("slack", { messages: [] }, true);
  assert.equal(jira.state, "empty");
  assert.equal(slack.state, "empty");
  assert.ok(jira.detail.includes("Searched Jira"));
  assert.ok(jira.detail.includes("Empty search"));
  assert.ok(!/no incident existed/i.test(jira.detail) || /≠|not/.test(jira.detail));
});

test("disconnected integrations say not connected", () => {
  const jira = resolveIncidentIntegrationStatus(
    "jira",
    { issues: [], error: "Jira credentials not configured." },
    false
  );
  assert.equal(jira.state, "not_connected");
  assert.ok(/not connected/i.test(jira.detail));

  const slackMissing = resolveIncidentIntegrationStatus("slack", undefined, false);
  assert.equal(slackMissing.state, "not_connected");
});

test("hits report counts", () => {
  const jira = resolveIncidentIntegrationStatus(
    "jira",
    { issues: [{ key: "PLN-1" }, { key: "PLN-2" }] },
    true
  );
  assert.equal(jira.state, "hits");
  assert.equal(jira.count, 2);
});

test("empty integrations still require explicit tickets + gaps sections", () => {
  const integrations = {
    jira: { issues: [] },
    slack: { messages: [] },
    jiraConnected: true,
    slackConnected: true
  };
  const codeOnly = `**Answer**
Found retry helpers in webhook_task.py.

**Symptoms**
- Webhook retries on board sync.
`;
  const enriched = enrichIncidentReconstructionResponse(codeOnly, integrations);
  assert.ok(enriched.includes(`**${INCIDENT_SECTION_CODE_PATHS}**`));
  assert.ok(enriched.includes(`**${INCIDENT_SECTION_INTEGRATIONS}**`));
  assert.ok(enriched.includes(`**${INCIDENT_SECTION_GAPS}**`));
  assert.ok(/Searched Jira/i.test(enriched));
  assert.ok(/Searched Slack/i.test(enriched));
  assert.ok(/Empty search|no matching/i.test(enriched));
  assert.ok(!/no incident happened/i.test(enriched));

  const gaps = buildIncidentGapsBullets(integrations);
  assert.ok(gaps.some((line) => /empty/i.test(line)));
  assert.ok(gaps.some((line) => /do not stop at/i.test(line)));
});

test("Tickets/threads alone still forces Integrations section", () => {
  const integrations = {
    jira: { issues: [] },
    slack: { messages: [] },
    jiraConnected: true,
    slackConnected: true
  };
  const withTicketsOnly = `**Answer**
Retries in webhookRegistry.

**${INCIDENT_SECTION_TICKETS_THREADS}**
- Some vague ticket note.
`;
  const enriched = enrichIncidentReconstructionResponse(withTicketsOnly, integrations);
  assert.ok(enriched.includes(`**${INCIDENT_SECTION_INTEGRATIONS}**`));
  assert.ok(/Searched Jira/i.test(enriched));
  assert.ok(/Searched Slack/i.test(enriched));
});

test("not connected still delivers gap section language", () => {
  const integrations = {
    jiraConnected: false,
    slackConnected: false
  };
  const bullets = buildIncidentTicketsThreadsBullets(integrations);
  assert.ok(bullets.every((line) => /not connected/i.test(line)));
  const gaps = buildIncidentGapsBullets(integrations);
  assert.ok(gaps.some((line) => /Connect missing tools/i.test(line)));
  const enriched = enrichIncidentReconstructionResponse("**Answer**\nRetries exist.", integrations);
  assert.ok(enriched.includes(`**${INCIDENT_SECTION_GAPS}**`));
  assert.ok(/not connected/i.test(enriched));
});

test("buildIncidentReconstructionUserPrompt requires all sections", () => {
  const prompt = buildIncidentReconstructionUserPrompt({
    userQuestion: "webhook failures last week on board sync",
    owner: "makeplane",
    repo: "plane",
    file: "apps/api/plane/bgtasks/webhook_task.py",
    integrations: {
      jira: { issues: [] },
      slack: { messages: [] },
      jiraConnected: true,
      slackConnected: true
    }
  });
  assert.ok(prompt.includes(INCIDENT_SECTION_SYMPTOMS));
  assert.ok(prompt.includes(INCIDENT_SECTION_CODE_PATHS));
  assert.ok(prompt.includes(INCIDENT_SECTION_TICKETS_THREADS));
  assert.ok(prompt.includes(INCIDENT_SECTION_GAPS));
  assert.ok(prompt.includes("Empty search ≠ proof"));
  assert.ok(prompt.includes("webhook_task.py"));
});

test("incidentIntegrationsFromBundle reads jira and slack", () => {
  const snap = incidentIntegrationsFromBundle(
    [
      {
        data: {
          jiraSearch: { issues: [{ key: "X-1" }] },
          slackSearch: { messages: [{ text: "failing" }] }
        }
      }
    ],
    { jiraConnected: true, slackConnected: true }
  );
  assert.equal(snap.jira?.issues?.length, 1);
  assert.equal(snap.slack?.messages?.length, 1);
  assert.equal(snap.jiraConnected, true);
});

const total = passed + failed;
console.log(`\nincidentReconstruction: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
