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
  isSignedIn: true,
  hasApiKey: true,
  apiBaseUrl: "http://localhost:8787"
} as Preferences;

test("displayOrgName returns org name and hides legacy placeholder", () => {
  assert.equal(displayOrgName({ orgName: "Acme Corp" }), "Acme Corp");
  assert.equal(displayOrgName({ orgName: "Legacy" }), undefined);
  assert.equal(displayOrgName({}), undefined);
});

test("displayPlanLabel maps plan ids to product names", () => {
  assert.equal(displayPlanLabel({ plan: "free" }), "Free");
  assert.equal(displayPlanLabel({ plan: "pro" }), "Pro");
  assert.equal(displayPlanLabel({ plan: "pro", usageTier: "pro_plus" }), "Pro+");
  assert.equal(displayPlanLabel({ plan: "pro", usageTier: "max" }), "Max");
  assert.equal(displayPlanLabel({ plan: "enterprise" }), "Enterprise");
  assert.equal(displayPlanLabel({}), "");
});

test("displayIdentitySubtitle combines org and plan when signed in", () => {
  assert.equal(
    displayIdentitySubtitle({ ...basePrefs, orgName: "Acme Corp", plan: "pro" }),
    "Acme Corp · Pro"
  );
  assert.equal(
    displayIdentitySubtitle({ ...basePrefs, orgName: "Acme Corp" }),
    "Acme Corp"
  );
  assert.equal(displayIdentitySubtitle({ ...basePrefs, hasApiKey: false, isSignedIn: false }), undefined);
});

test("accountHubSubtitle reports sign-in with user email", () => {
  assert.equal(
    accountHubSubtitle({ ...basePrefs, orgName: "Acme Corp", userEmail: "jon@acme.com" }),
    "Signed in · jon@acme.com"
  );
  assert.equal(
    accountHubSubtitle({
      ...basePrefs,
      orgName: "Acme Corp",
      userEmail: "jon@acme.com",
      plan: "free",
      quotaCredits: { remainingCredits: 3, limitCredits: 10, usedCredits: 7, windowHours: 24, resetsAt: "", retryAfterMs: 0 }
    }),
    "Signed in · jon@acme.com"
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
    "Free · 56K of 80K used"
  );
  assert.equal(planUsageHubSubtitle({ ...basePrefs, hasApiKey: false, isSignedIn: false }), "Sign in to view plan");
  assert.equal(
    planUsageHubSubtitle({
      ...basePrefs,
      plan: "pro",
      usageTier: "pro",
      usageMeters: {
        usageTier: "pro",
        displayName: "Pro",
        seatPriceUsd: 25,
        periodStart: "2026-09-01T00:00:00.000Z",
        periodEnd: "2026-10-01T00:00:00.000Z",
        auto: { usedCents: 2000, limitCents: 4000, remainingCents: 2000, usedRatio: 0.5 },
        frontier: { usedCents: 0, limitCents: 2500, remainingCents: 2500, usedRatio: 0 }
      }
    }),
    "Pro · Auto 50%"
  );
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
  assert.equal(indexingHubSubtitle({ ...basePrefs, hasApiKey: false, isSignedIn: false }), "Sign in to view indexing");
  assert.equal(
    indexingHubSubtitle({ ...basePrefs }, { readyRepos: 2, indexingRepos: 1, indexedRepoCount: 2, indexedRepoLimit: 3 }),
    "2 ready · 1 building"
  );
});

test("accountHubSubtitle falls back without email", () => {
  assert.equal(accountHubSubtitle(basePrefs), "Signed in");
  assert.equal(accountHubSubtitle({ ...basePrefs, userEmail: "  " }), "Signed in");
  assert.equal(accountHubSubtitle({ ...basePrefs, hasApiKey: false, isSignedIn: false }), "Not signed in");
});

console.log(`\nconnectionCopy: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
