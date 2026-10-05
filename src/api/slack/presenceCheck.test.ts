import assert from "node:assert/strict";
import { buildPresenceDisplayLabel, buildSlackLookupCandidates, checkSlackPresence, clearPresenceCaches, resolveSlackUserForGithubIdentity } from "./presenceCheck";
import type { SlackClient } from "./slackClient";
import type { IdentityDirectory } from "../../identity/types";

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

test("buildSlackLookupCandidates includes login, display name, and first-name token", () => {
  const candidates = buildSlackLookupCandidates({
    githubLogin: "raneyja",
    displayName: "Jon Raney"
  });
  assert.deepEqual(candidates, ["raneyja", "Jon Raney", "Jon"]);
});

test("buildSlackLookupCandidates prefers email before login", () => {
  const candidates = buildSlackLookupCandidates({
    email: "jon@coop-ai.dev",
    githubLogin: "raneyja",
    displayName: "Jon Raney"
  });
  assert.equal(candidates[0], "jon@coop-ai.dev");
  assert.ok(candidates.includes("Jon"));
});

test("buildPresenceDisplayLabel appends linked once even when cached label already has suffix", () => {
  const label = buildPresenceDisplayLabel(
    {
      state: "active",
      label: "Active (11:12 AM PDT) · linked",
      timezone: "America/Los_Angeles",
      slackUserId: "U123"
    },
    { linkedPerson: true, source: "explicit" },
    Date.parse("2026-06-07T18:12:00Z")
  );
  assert.equal(label, "Active (11:12 AM PDT) · linked");
});

test("buildPresenceDisplayLabel appends inferred for unlinked resolution", () => {
  const label = buildPresenceDisplayLabel(
    {
      state: "active",
      label: "Active",
      timezone: "America/Los_Angeles",
      slackUserId: "U123"
    },
    { linkedPerson: false, source: "inferred" },
    Date.parse("2026-06-07T18:12:00Z")
  );
  assert.ok(label.endsWith("· inferred"));
  assert.equal(label.split("· inferred").length, 2);
});

test("a known person with failed explicit Slack lookup keeps inferred fallback qualification", () => {
  const label = buildPresenceDisplayLabel(
    { state: "active", label: "Active" },
    { linkedPerson: true, source: "inferred" }
  );
  assert.ok(label.endsWith("· inferred"));
  assert.doesNotMatch(label, /· linked/);
});

async function verifyCacheIsolation(): Promise<void> {
  const first = {
    findUserByName: async () => "UFIRST",
    getUserPresence: async () => ({ presence: "active" }),
    getUserInfo: async () => undefined
  } as unknown as SlackClient;
  const second = {
    findUserByName: async () => "USECOND",
    getUserPresence: async () => ({ presence: "away" }),
    getUserInfo: async () => undefined
  } as unknown as SlackClient;
  const options = { now: () => 1000 };
  assert.equal((await resolveSlackUserForGithubIdentity(first, { githubLogin: "cache-fixture" }, options)).userId, "UFIRST");
  assert.equal((await resolveSlackUserForGithubIdentity(second, { githubLogin: "cache-fixture" }, options)).userId, "USECOND", "identity cache cannot reuse another connection's user");
  passed++;
  assert.equal((await checkSlackPresence(first, "USHARED", options)).state, "active");
  assert.equal((await checkSlackPresence(second, "USHARED", options)).state, "away", "presence cache cannot reuse another connection's state");
  passed++;
  const directory = (userId: string): IdentityDirectory => ({ version: 1, people: [{
    id: "person", displayName: "Fixture", links: [
      { provider: "github", externalId: "linked-fixture" }, { provider: "slack", externalId: userId }
    ]
  }] });
  assert.equal((await resolveSlackUserForGithubIdentity(first, { githubLogin: "linked-fixture" }, { ...options, identityDirectory: directory("UOLD") })).userId, "UOLD");
  assert.equal((await resolveSlackUserForGithubIdentity(first, { githubLogin: "linked-fixture" }, { ...options, identityDirectory: directory("UNEW") })).userId, "UNEW", "same-count directory edits invalidate old identity linkage");
  passed++;
  let userId = "UBEFORE";
  let state = "active";
  const resetClient = {
    findUserByName: async () => userId,
    getUserPresence: async () => ({ presence: state }),
    getUserInfo: async () => undefined
  } as unknown as SlackClient;
  assert.equal((await resolveSlackUserForGithubIdentity(resetClient, { githubLogin: "reset-fixture" }, options)).userId, "UBEFORE");
  assert.equal((await checkSlackPresence(resetClient, "URESET", options)).state, "active");
  userId = "UAFTER";
  state = "away";
  assert.equal((await resolveSlackUserForGithubIdentity(resetClient, { githubLogin: "reset-fixture" }, options)).userId, "UBEFORE", "same client cache is active before reset");
  clearPresenceCaches();
  assert.equal((await resolveSlackUserForGithubIdentity(resetClient, { githubLogin: "reset-fixture" }, options)).userId, "UAFTER");
  assert.equal((await checkSlackPresence(resetClient, "URESET", options)).state, "away");
  passed++;
}
void verifyCacheIsolation().catch((error: unknown) => { failed++; console.error(error); }).finally(() => {
  console.log(`\npresenceCheck: ${passed}/${passed + failed} tests passed`);
  if (failed > 0) process.exitCode = 1;
});
