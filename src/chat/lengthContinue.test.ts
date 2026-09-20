import assert from "node:assert/strict";
import {
  LENGTH_CUTOFF_NOTICE,
  hasTrailingEmptyHeadings,
  shouldContinueForLengthStop,
  withLengthCutoffNotice
} from "./lengthContinue";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

test("detects trailing heading-only sections", () => {
  const content = [
    "401 writers live in requireAuth and jobsApi.",
    "",
    "**requireAuth behavior gating**",
    "",
    "**Tests asserting on 401**",
    "",
    "**Client-side error handling**",
    "",
    "**Webhook path**"
  ].join("\n");
  assert.equal(hasTrailingEmptyHeadings(content), true);
});

test("filled last heading is not a length stop", () => {
  const content = [
    "Lead sentence.",
    "",
    "**Webhook path**",
    "",
    "- `src/webhooks/webhookServer.ts` returns 401 when the signature is missing."
  ].join("\n");
  assert.equal(hasTrailingEmptyHeadings(content), false);
});

test("finishReason length continues once", () => {
  assert.equal(
    shouldContinueForLengthStop({
      finishReason: "length",
      content: "partial",
      alreadyContinued: false
    }),
    true
  );
  assert.equal(
    shouldContinueForLengthStop({
      finishReason: "length",
      content: "partial",
      alreadyContinued: true
    }),
    false
  );
  assert.equal(
    shouldContinueForLengthStop({
      finishReason: "stop",
      content: "complete answer",
      alreadyContinued: false
    }),
    false
  );
});

test("cutoff notice is visible and not duplicated", () => {
  const once = withLengthCutoffNotice("partial");
  assert.match(once, new RegExp(LENGTH_CUTOFF_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(withLengthCutoffNotice(once), once);
});

console.log(`\nlengthContinue: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
