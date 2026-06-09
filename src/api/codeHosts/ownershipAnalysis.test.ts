import assert from "node:assert/strict";
import { calculateOwnershipScores, type OwnershipSignals } from "./ownershipAnalysis";

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

test("calculateOwnershipScores propagates github login from commit stats", () => {
  const signals: OwnershipSignals = {
    commits: [
      {
        author: "raneyja",
        authorLogin: "raneyja",
        counts: { sixMonths: 2, oneYear: 2, allTime: 2 },
        recencyScore: 2,
        lastCommitDate: new Date().toISOString(),
        messages: []
      }
    ],
    reviews: [],
    issues: [],
    activity: [
      {
        author: "raneyja",
        lastActiveDate: new Date().toISOString(),
        weight: 1,
        inactive: false
      }
    ]
  };

  const scores = calculateOwnershipScores(signals);
  assert.equal(scores.length, 1);
  assert.equal(scores[0]?.owner, "raneyja");
  assert.equal(scores[0]?.githubLogin, "raneyja");
});

console.log(`\nownershipAnalysis: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
