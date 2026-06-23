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

test("resolveEffectiveQuickAction reads /understand slash command", () => {
  const history = [userMessage("/understand")];
  assert.equal(resolveEffectiveQuickAction(undefined, history), "understand-repo");
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

test("resolveEffectiveQuickAction reads find-owner slash aliases", () => {
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/owner")]), "find-owner");
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/who")]), "find-owner");
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/find-owner")]), "find-owner");
});

test("resolveEffectiveQuickAction reads find-owner tag from history for follow-ups", () => {
  const history = [userMessage("[find-owner] Find who owns this area and how to reach them.\nfile: src/handler.ts · repo: acme/widgets")];
  assert.equal(resolveEffectiveQuickAction(undefined, history), "find-owner");
});

test("resolveEffectiveQuickAction reads trace-decision slash commands", () => {
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/trace")]), "trace-decision");
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/why")]), "trace-decision");
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/decision")]), "trace-decision");
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/history")]), "trace-decision");
  assert.equal(
    resolveEffectiveQuickAction(undefined, [userMessage("[trace-decision] Trace the engineering decision behind this code.")]),
    "trace-decision"
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
