import assert from "node:assert/strict";
import { accountHubSubtitle, displayOrgName } from "./connectionCopy";
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

test("accountHubSubtitle prefers organization name when signed in", () => {
  assert.equal(accountHubSubtitle({ ...basePrefs, orgName: "Acme Corp" }), "Acme Corp");
  assert.equal(
    accountHubSubtitle({ ...basePrefs, orgName: "Acme Corp", plan: "free", quotaCredits: { remainingCredits: 3, limitCredits: 10, usedCredits: 7, windowHours: 24, resetsAt: "", retryAfterMs: 0 } }),
    "Acme Corp · 3 of 10 AI credits left"
  );
});

test("accountHubSubtitle falls back to API host without org name", () => {
  assert.equal(accountHubSubtitle(basePrefs), "Signed in · localhost:8787");
  assert.equal(accountHubSubtitle({ ...basePrefs, hasApiKey: false }), "Not signed in");
});

console.log(`\nconnectionCopy: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
