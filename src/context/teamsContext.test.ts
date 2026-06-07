import assert from "node:assert/strict";
import { wantsTeamsContext } from "./teamsContext";

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

test("wantsTeamsContext matches explicit teams questions", () => {
  assert.equal(wantsTeamsContext("any microsoft teams threads about this repo?"), true);
  assert.equal(wantsTeamsContext("What is the auth flow?"), false);
});

test("wantsTeamsContext matches discussion + teams phrasing", () => {
  assert.equal(wantsTeamsContext("any messages in teams related to this repository?"), true);
});

const total = passed + failed;
console.log(`\nteamsContext: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
