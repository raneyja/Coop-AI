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

test("plain follow-up after /understand does not inherit the action", () => {
  const history = [userMessage("/understand")];
  assert.equal(resolveEffectiveQuickAction(undefined, history), undefined);
});

test("plain follow-up after a [knowledge-gaps] tag does not inherit", () => {
  const history = [userMessage("[knowledge-gaps] Audit documentation and ownership gaps for this area.")];
  assert.equal(resolveEffectiveQuickAction(undefined, history), undefined);
});

test("plain follow-up after /gaps does not inherit", () => {
  const history = [userMessage("/gaps")];
  assert.equal(resolveEffectiveQuickAction(undefined, history), undefined);
});

test("plain follow-up after /blast does not inherit Blast", () => {
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/unknowns")]), undefined);
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/blast")]), undefined);
});

test("plain follow-up after /owner aliases does not inherit Find Owner", () => {
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/owner")]), undefined);
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/who")]), undefined);
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/find-owner")]), undefined);
});

test("explicit /blast on this send still returns blast-radius", () => {
  assert.equal(resolveEffectiveQuickAction("blast-radius", [userMessage("/blast")]), "blast-radius");
});

test("plain follow-up after find-owner tag does not inherit", () => {
  const history = [userMessage("[find-owner] Find who owns this area and how to reach them.\nfile: src/handler.ts · repo: acme/widgets")];
  assert.equal(resolveEffectiveQuickAction(undefined, history), undefined);
});

test("plain follow-up after /trace aliases does not inherit Trace", () => {
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/trace")]), undefined);
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/why")]), undefined);
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/decision")]), undefined);
  assert.equal(resolveEffectiveQuickAction(undefined, [userMessage("/history")]), undefined);
  assert.equal(
    resolveEffectiveQuickAction(undefined, [userMessage("[trace-decision] Trace the engineering decision behind this code.")]),
    undefined
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
