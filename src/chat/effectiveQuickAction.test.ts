import assert from "node:assert/strict";
import type { ChatMessage } from "./types";
import { resolveEffectiveQuickAction } from "./effectiveQuickAction";

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

function userMessage(content: string): ChatMessage {
  return { role: "user", content, timestamp: Date.now() };
}

test("resolveEffectiveQuickAction prefers explicit quickAction param", () => {
  assert.equal(resolveEffectiveQuickAction("knowledge-gaps", [userMessage("/gaps")]), "knowledge-gaps");
});

test("resolveEffectiveQuickAction reads quick-action tag from history", () => {
  const history = [userMessage("[knowledge-gaps] Audit documentation and ownership gaps for this area.")];
  assert.equal(resolveEffectiveQuickAction(undefined, history), "knowledge-gaps");
});

test("resolveEffectiveQuickAction reads slash command token from history", () => {
  const history = [userMessage("/gaps")];
  assert.equal(resolveEffectiveQuickAction(undefined, history), "knowledge-gaps");
});

test("resolveEffectiveQuickAction reads slash aliases", () => {
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/unknowns")]), "knowledge-gaps");
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/blast")]), "blast-radius");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
