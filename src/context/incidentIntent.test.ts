import assert from "node:assert/strict";
import {
  isIncidentShapedQuery,
  isStatusTransitionIntent,
  isTicketPickupLocateQuery,
  shouldFetchIncidentIntegrations
} from "./incidentIntent";

const I4_TICKET_PICKUP_ASK =
  "I'm covering COOP-101 this week — peel auth into coop-backend. What in this repo still owns requireAuth, and what's the safest first extraction so we don't break every VS Code session?";

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

test("smoke: board sync / webhook failures is incident-shaped", () => {
  assert.equal(
    isIncidentShapedQuery(
      "board sync / webhook failures last week — what retries and was there an incident?"
    ),
    true
  );
  assert.equal(shouldFetchIncidentIntegrations("webhook failures and retries on board sync"), true);
});

test("A9 smoke ask is incident-shaped even when it names Jira/Slack", () => {
  assert.equal(
    isIncidentShapedQuery(
      "Last week’s webhook delivery failures — what Jira tickets and Slack threads are related, which code paths handle retries/monitoring, and what’s still open?"
    ),
    true
  );
});

test("outage / on-call / incident keywords match", () => {
  assert.equal(isIncidentShapedQuery("was there an outage in payments?"), true);
  assert.equal(isIncidentShapedQuery("on-call: API errors last week"), true);
  assert.equal(isIncidentShapedQuery("summarize the SEV2 incident"), true);
});

test("leading operational labels are metadata; body signals decide incident routing", () => {
  for (const label of ["Pager:", "On-call:", "Sev:", "Incident:"]) {
    assert.equal(isIncidentShapedQuery(`${label} where is requireAuth defined?`), false, label);
    assert.equal(
      isIncidentShapedQuery(`${label} webhook failures caused an outage last week`),
      true,
      label
    );
  }
  assert.equal(isIncidentShapedQuery("Pager: where is date math implemented?"), false);
  assert.equal(isIncidentShapedQuery("On-call: explain DateTimeUtils"), false);
  assert.equal(isIncidentShapedQuery("Incident: webhook failures and retries"), true);
});

test("plain architecture questions are not incident-shaped", () => {
  assert.equal(isIncidentShapedQuery("What is the auth flow?"), false);
  assert.equal(isIncidentShapedQuery("how does webhook_task work?"), false);
});

test("A8 status-transition asks are not incident-shaped", () => {
  assert.equal(
    isStatusTransitionIntent("stuck PENDING — where does status move to COMPLETED?"),
    true
  );
  assert.equal(
    isIncidentShapedQuery("stuck PENDING — where does status move to COMPLETED?"),
    false
  );
  assert.equal(
    isIncidentShapedQuery("which job writes DocumentStatus to COMPLETED in seal-document?"),
    false
  );
});

test("status-transition + strong incident signal still counts as incident", () => {
  assert.equal(
    isIncidentShapedQuery("incident: documents stuck PENDING during the outage — where does status move?"),
    true
  );
});

test("stuck alone without ops co-signal is not incident", () => {
  assert.equal(isIncidentShapedQuery("why is this UI stuck?"), false);
  assert.equal(isIncidentShapedQuery("stuck after webhook retry storm"), true);
});

test("bare week phrases are not incident; failure words still are", () => {
  assert.equal(isIncidentShapedQuery("I'm covering COOP-101 this week"), false);
  assert.equal(isIncidentShapedQuery("what happened last week"), false);
  assert.equal(isIncidentShapedQuery("standup notes from the past week"), false);
  assert.equal(isIncidentShapedQuery("errors last week"), true);
  assert.equal(isIncidentShapedQuery("webhook failures last week"), true);
});

test("I4 ticket pickup ask is not incident-shaped", () => {
  assert.equal(isIncidentShapedQuery(I4_TICKET_PICKUP_ASK), false);
  assert.equal(isTicketPickupLocateQuery(I4_TICKET_PICKUP_ASK), true);
  assert.equal(shouldFetchIncidentIntegrations(I4_TICKET_PICKUP_ASK), false);
});

const total = passed + failed;
console.log(`\nincidentIntent: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
