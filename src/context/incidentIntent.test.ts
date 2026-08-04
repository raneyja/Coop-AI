import assert from "node:assert/strict";
import {
  isIncidentShapedQuery,
  isStatusTransitionIntent,
  shouldFetchIncidentIntegrations
} from "./incidentIntent";

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

test("outage / on-call / incident keywords match", () => {
  assert.equal(isIncidentShapedQuery("was there an outage in payments?"), true);
  assert.equal(isIncidentShapedQuery("on-call: API errors last week"), true);
  assert.equal(isIncidentShapedQuery("summarize the SEV2 incident"), true);
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

const total = passed + failed;
console.log(`\nincidentIntent: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
