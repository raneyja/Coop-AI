import assert from "node:assert/strict";
import { buildPresenceDisplayLabel, buildSlackLookupCandidates } from "./presenceCheck";

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

const total = passed + failed;
console.log(`\npresenceCheck: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
