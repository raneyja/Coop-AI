import assert from "node:assert/strict";
import { mentionPathMinScore, scoreMentionPath } from "./mentionPathScore";

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

test("@plugin keyword matches plugin-utils basename above mention min score", () => {
  const score = scoreMentionPath("lib/plugin-utils.js", "plugin");
  assert.ok(score >= mentionPathMinScore("plugin"));
});

test("@plugin keyword matches plugin paths strongly", () => {
  assert.ok(scoreMentionPath("lib/plugin.js", "plugin") >= mentionPathMinScore("plugin"));
});

console.log(`\nmentionPathSearch: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
