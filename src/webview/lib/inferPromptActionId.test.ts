import assert from "node:assert/strict";
import { inferActionIdFromTemplate } from "./inferPromptActionId";

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

test("inferActionIdFromTemplate returns actionId for quick-action slash commands", () => {
  assert.equal(inferActionIdFromTemplate("/understand map the webhook flow"), "understand-repo");
  assert.equal(inferActionIdFromTemplate("/gaps"), "knowledge-gaps");
  assert.equal(inferActionIdFromTemplate("/trace why was retry added"), "trace-decision");
});

test("inferActionIdFromTemplate returns undefined for integration slash commands", () => {
  assert.equal(inferActionIdFromTemplate("/slack who decided redis"), undefined);
  assert.equal(inferActionIdFromTemplate("/jira ABC-1"), undefined);
});

test("inferActionIdFromTemplate returns undefined for plain chat text", () => {
  assert.equal(inferActionIdFromTemplate("Explain {{file}} on branch {{branch}}"), undefined);
  assert.equal(inferActionIdFromTemplate(""), undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
