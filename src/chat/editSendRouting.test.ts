import assert from "node:assert/strict";
import {
  resolveEditTrackingMessage,
  shouldTrackEditRequest
} from "./editSendRouting";

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

test("shouldTrackEditRequest is true for edit composer without quick action", () => {
  assert.equal(shouldTrackEditRequest({ composerMode: "edit" }, undefined), true);
});

test("shouldTrackEditRequest is false for ask composer or quick actions", () => {
  assert.equal(shouldTrackEditRequest({ composerMode: "ask" }, undefined), false);
  assert.equal(shouldTrackEditRequest({ composerMode: "edit" }, "explain"), false);
  assert.equal(shouldTrackEditRequest(undefined, undefined), false);
});

test("resolveEditTrackingMessage prefers historyContent over raw message", () => {
  assert.equal(
    resolveEditTrackingMessage("fix the bug", {
      composerMode: "edit",
      historyContent: "/edit fix the bug"
    }),
    "/edit fix the bug"
  );
});

test("resolveEditTrackingMessage appends mention scope to bubble text", () => {
  const content = resolveEditTrackingMessage("update auth flow", { composerMode: "edit" }, [
    { path: "src/auth.ts", label: "src/auth.ts" }
  ]);
  assert.match(content, /update auth flow/);
  assert.match(content, /src\/auth\.ts/);
});

console.log(`\neditSendRouting: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
