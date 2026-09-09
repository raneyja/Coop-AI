import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isProductUsageEvent, shouldRecordUsageEvent } from "./usageEventPolicy";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

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

test("Admin and quota events send when VS Code telemetry is off", () => {
  const product = [
    "chat.message",
    "chat.completion",
    "completion.requested",
    "completion.suggested",
    "completion.accepted",
    "completion.rejected",
    "completion.performance",
    "quick_action.trace_decision",
    "quick_action.find_owner",
    "edit.requested",
    "edit.patch_applied",
    "edit.patch_rejected",
    "lightning.search"
  ];
  for (const eventType of product) {
    assert.equal(isProductUsageEvent(eventType), true, eventType);
    assert.equal(shouldRecordUsageEvent(eventType, false), true, eventType);
  }
});

test("suggested-next-step and intent-classifier events require telemetry on", () => {
  const analytics = [
    "suggest_chip.shown",
    "suggest_chip.dismissed",
    "suggest_chip.accepted",
    "suggest_intent.model_invoked",
    "suggest_intent.model_none",
    "suggest_intent.model_hit",
    "suggest_intent.model_error",
    "chat_intent.silent_workflow",
    "chat_intent.confirm_workflow",
    "chat_intent.tools_only"
  ];
  for (const eventType of analytics) {
    assert.equal(isProductUsageEvent(eventType), false, eventType);
    assert.equal(shouldRecordUsageEvent(eventType, false), false, eventType);
    assert.equal(shouldRecordUsageEvent(eventType, true), true, eventType);
  }
});

test("unknown events follow VS Code telemetry (fail closed when off)", () => {
  assert.equal(shouldRecordUsageEvent("mystery.event", false), false);
  assert.equal(shouldRecordUsageEvent("mystery.event", true), true);
  assert.equal(shouldRecordUsageEvent("   ", true), false);
});

test("chat_intent is not treated as chat.message", () => {
  assert.equal(isProductUsageEvent("chat_intent.silent_workflow"), false);
  assert.equal(isProductUsageEvent("chat.message"), true);
});

test("every CoopChatSession emitUsageEvent is explicitly product or analytics", () => {
  const session = readFileSync(join(repoRoot, "src/chat/CoopChatSession.ts"), "utf8");
  const literals = [...session.matchAll(/emitUsageEvent\("([^"`]+)"/g)].map((match) => match[1]);
  assert.ok(literals.length > 0, "expected literal emitUsageEvent calls");
  for (const eventType of literals) {
    const product = isProductUsageEvent(eventType);
    const analytics = eventType.startsWith("suggest_") || eventType.startsWith("chat_intent.");
    assert.equal(
      product || analytics,
      true,
      `unclassified usage event ${eventType} — add it to usageEventPolicy`
    );
  }
  assert.match(session, /emitUsageEvent\(`quick_action\./);
});

test("SecureApiClient gates recordUsageEvents through shouldRecordUsageEvent", () => {
  const source = readFileSync(join(repoRoot, "src/chat/SecureApiClient.ts"), "utf8");
  assert.match(source, /shouldRecordUsageEvent/);
  assert.match(source, /vscode\.env\.isTelemetryEnabled/);
});

console.log(`\nusageEventPolicy: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
