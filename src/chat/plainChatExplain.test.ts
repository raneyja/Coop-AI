import assert from "node:assert/strict";
import { isOpenFileExplainAsk, semanticAttachModeForChat } from "./plainChatExplain";

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

test("dogfood 1b explain requireAuth is an open-file explain ask", () => {
  assert.equal(
    isOpenFileExplainAsk(
      "Explain requireAuth in this file. When does it allow an unauthenticated request through, and what should a reviewer check before we make auth required in production?"
    ),
    true
  );
});

test("locate ask is not an explain briefing", () => {
  assert.equal(isOpenFileExplainAsk("Where is APIKeyAuthentication defined?"), false);
});

test("explain + open file uses path hits only (no extra bodies)", () => {
  assert.equal(
    semanticAttachModeForChat({
      query: "Walk me through StateGroup in this file. What values exist?",
      openFile: "apps/api/plane/db/models/state.py"
    }),
    "paths-only"
  );
});

test("explain without an open file still attaches search bodies", () => {
  assert.equal(
    semanticAttachModeForChat({
      query: "Explain requireAuth",
      openFile: undefined
    }),
    "bodies"
  );
});

console.log(`\nplainChatExplain: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
