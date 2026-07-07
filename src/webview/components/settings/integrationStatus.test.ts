import assert from "node:assert/strict";
import type { Preferences } from "./types";
import {
  integrationReady,
  memberToolStatusLabel,
  resolveMemberToolStatus
} from "./integrationStatus";
import { toolsHubSubtitle } from "./connectionCopy";
import { integrationConfigured } from "./subtitles";

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
  apiBaseUrl: "http://localhost:8787",
  devMode: false,
  plan: "enterprise"
} as Preferences;

test("resolveMemberToolStatus marks enterprise slack scope required as pending admin setup", () => {
  const prefs = {
    ...basePrefs,
    orgIntegrationStatuses: [
      { provider: "slack" as const, installed: true, scopeStatus: "required" as const }
    ]
  };
  assert.equal(resolveMemberToolStatus(prefs, "slack"), "pending_admin_setup");
  assert.equal(memberToolStatusLabel("pending_admin_setup"), "Pending admin setup");
});

test("resolveMemberToolStatus marks installed slack with active scope as ready", () => {
  const prefs = {
    ...basePrefs,
    orgIntegrationStatuses: [
      { provider: "slack" as const, installed: true, scopeStatus: "active" as const }
    ],
    slackTeamName: "Acme"
  };
  assert.equal(resolveMemberToolStatus(prefs, "slack"), "ready");
});

test("integrationConfigured stays installed while integrationReady waits for scope", () => {
  const prefs = {
    ...basePrefs,
    orgIntegrationStatuses: [
      { provider: "slack" as const, installed: true, scopeStatus: "required" as const }
    ]
  };
  assert.equal(integrationConfigured(prefs, "slack"), true);
  assert.equal(integrationReady(prefs, "slack"), false);
});

test("toolsHubSubtitle counts ready tools instead of merely connected", () => {
  const prefs = {
    ...basePrefs,
    orgIntegrationStatuses: [
      { provider: "github" as const, installed: true },
      { provider: "slack" as const, installed: true, scopeStatus: "required" as const },
      { provider: "teams" as const, installed: false }
    ],
    hasGitHubAppInstalled: true,
    hasSlackInstalled: true,
    hasTeamsInstalled: false
  };
  assert.equal(toolsHubSubtitle(prefs), "1 of 9 ready");
});

console.log(`\nintegrationStatus: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
