import assert from "node:assert/strict";
import {
  accountHubSubtitle,
  displayIdentitySubtitle,
  displayOrgName,
  displayPlanLabel,
  formatQuotaUsageSummary,
  indexingHubSubtitle,
  planUsageHubSubtitle
} from "./connectionCopy";
import type { Preferences } from "./types";

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

const basePrefs = {
  hasApiKey: true,
  apiBaseUrl: "http://localhost:8787"
} as Preferences;

test("displayOrgName returns org name and hides legacy placeholder", () => {
  assert.equal(displayOrgName({ orgName: "Acme Corp" }), "Acme Corp");
  assert.equal(displayOrgName({ orgName: "Legacy" }), undefined);
  assert.equal(displayOrgName({}), undefined);
});

test("displayPlanLabel maps plan ids to product names", () => {
  assert.equal(displayPlanLabel({ plan: "free" }), "Developer (free)");
  assert.equal(displayPlanLabel({ plan: "pro" }), "Pro");
  assert.equal(displayPlanLabel({ plan: "enterprise" }), "Enterprise");
  assert.equal(displayPlanLabel({}), "Developer (free)");
});

test("displayIdentitySubtitle combines org and plan when signed in", () => {
  assert.equal(
    displayIdentitySubtitle({ ...basePrefs, orgName: "Acme Corp", plan: "pro" }),
    "Acme Corp · Pro"
  );
  assert.equal(displayIdentitySubtitle({ ...basePrefs, hasApiKey: false }), undefined);
});

test("accountHubSubtitle reports API connection status", () => {
  assert.equal(accountHubSubtitle({ ...basePrefs, orgName: "Acme Corp" }), "API key configured · localhost:8787");
  assert.equal(
    accountHubSubtitle({ ...basePrefs, orgName: "Acme Corp", plan: "free", quotaCredits: { remainingCredits: 3, limitCredits: 10, usedCredits: 7, windowHours: 24, resetsAt: "", retryAfterMs: 0 } }),
    "API key configured · localhost:8787"
  );
});

test("planUsageHubSubtitle shows plan and used credits", () => {
  assert.equal(planUsageHubSubtitle({ ...basePrefs, orgName: "Acme Corp", plan: "pro" }), "Pro");
  assert.equal(
    planUsageHubSubtitle({
      ...basePrefs,
      orgName: "Acme Corp",
      plan: "free",
      quotaCredits: { remainingCredits: 24, limitCredits: 80, usedCredits: 56, windowHours: 5, resetsAt: "", retryAfterMs: 0 }
    }),
    "Developer (free) · 56K of 80K used"
  );
  assert.equal(planUsageHubSubtitle({ ...basePrefs, hasApiKey: false }), "Sign in to view plan");
});

test("formatQuotaUsageSummary shows used credits in K format", () => {
  assert.equal(
    formatQuotaUsageSummary({
      usedCredits: 56,
      limitCredits: 80,
      remainingCredits: 24,
      windowHours: 5
    }),
    "56K of 80K AI credits used - 5-hour rolling window"
  );
});

test("indexingHubSubtitle summarizes lightning state", () => {
  assert.equal(indexingHubSubtitle({ ...basePrefs, hasApiKey: false }), "Sign in to view indexing");
  assert.equal(
    indexingHubSubtitle({ ...basePrefs }, { readyRepos: 2, indexingRepos: 1, indexedRepoCount: 2, indexedRepoLimit: 3 }),
    "2 ready · 1 building"
  );
});

test("accountHubSubtitle falls back without org name", () => {
  assert.equal(accountHubSubtitle(basePrefs), "API key configured · localhost:8787");
  assert.equal(accountHubSubtitle({ ...basePrefs, hasApiKey: false }), "Not signed in");
});

console.log(`\nconnectionCopy: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
