import assert from "node:assert/strict";
import { shouldFetchTeamsContext } from "../context/teamsContext";
import { toolsImpliedByJobs } from "../chat/intentPlanner/planChatJobs";
import { isTeamsComingSoon } from "./teamsAvailability";
import type { ContextFetchRequest } from "../context/requestBatcher";

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

test("Teams is not implied or fetched while coming soon", () => {
  assert.equal(isTeamsComingSoon(), true);
  const unnamed = toolsImpliedByJobs({
    jobs: [{ capability: "decision", terms: ["session ttl"] }],
    namedTools: [],
    namedProducts: [],
    connectedTools: ["slack", "jira", "teams"],
    decisionImplied: true
  });
  assert.equal(unnamed.includes("teams"), false);
  assert.equal(unnamed.includes("slack"), true);
  assert.equal(unnamed.includes("jira"), true);

  const namedTeams = toolsImpliedByJobs({
    jobs: [{ capability: "decision", terms: ["session ttl"] }],
    namedTools: ["teams"],
    namedProducts: ["teams"],
    connectedTools: ["slack", "jira", "teams"],
    decisionImplied: true
  });
  assert.equal(namedTeams.includes("teams"), false);
  assert.equal(namedTeams.includes("slack"), false);

  const request = {
    type: "chat_context",
    params: { integrationProvider: "teams", fetchIntegrations: ["teams"] },
    intent: { context: { queryText: "any teams threads about auth?" } }
  } as ContextFetchRequest;
  assert.equal(shouldFetchTeamsContext(request), false);
});

const total = passed + failed;
console.log(`\nteamsAvailability: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
