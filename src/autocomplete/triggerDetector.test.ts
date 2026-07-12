import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { TriggerDetector, isImmediateTriggerLine } from "./triggerDetector";
import type { AutocompleteSettings, ExtractedCodeContext, CompletionTriggerContext } from "./types";

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

function baseSettings(overrides: Partial<AutocompleteSettings> = {}): AutocompleteSettings {
  return {
    enabled: true,
    trigger: "auto",
    maxSuggestionLength: 200,
    debounceMs: 300,
    model: "haiku",
    customModel: "",
    showMultipleSuggestions: false,
    requestTimeoutMs: 400,
    useFim: true,
    ...overrides
  };
}

function baseContext(overrides: Partial<ExtractedCodeContext> = {}): ExtractedCodeContext {
  return {
    languageId: "typescript",
    filePath: "/workspace/src/example.ts",
    currentLinePrefix: "const value = ",
    currentLineSuffix: "",
    previousLines: "",
    importsBlock: "",
    parentSignature: "",
    indent: "  ",
    cursorOffset: 20,
    contextHash: "hash-a",
    inComment: false,
    inString: false,
    afterDot: false,
    afterOpenParen: false,
    riskySyntax: false,
    ...overrides
  };
}

function autoTrigger(): CompletionTriggerContext {
  return { kind: "auto", vscodeKind: vscode.InlineCompletionTriggerKind.Automatic };
}

function manualTrigger(): CompletionTriggerContext {
  return { kind: "manual", vscodeKind: vscode.InlineCompletionTriggerKind.Invoke };
}

test("returns disabled when autocomplete is off", () => {
  const detector = new TriggerDetector();
  const decision = detector.evaluate(baseSettings({ enabled: false }), baseContext(), autoTrigger());
  assert.equal(decision.shouldRequest, false);
  assert.equal(decision.reason, "disabled");
});

test("skips comments and strings", () => {
  const detector = new TriggerDetector();
  assert.equal(
    detector.evaluate(baseSettings(), baseContext({ inComment: true }), autoTrigger()).shouldRequest,
    false
  );
  assert.equal(
    detector.evaluate(baseSettings(), baseContext({ inString: true }), autoTrigger()).shouldRequest,
    false
  );
});

test("manual mode requires manual trigger", () => {
  const detector = new TriggerDetector();
  const settings = baseSettings({ trigger: "manual" });
  assert.equal(detector.evaluate(settings, baseContext(), autoTrigger()).reason, "manual_only");
  assert.equal(detector.evaluate(settings, baseContext(), manualTrigger()).shouldRequest, true);
});

test("debounces automatic triggers", () => {
  const detector = new TriggerDetector();
  const decision = detector.evaluate(
    baseSettings(),
    baseContext({ currentLinePrefix: "console.log" }),
    autoTrigger()
  );
  assert.equal(decision.shouldRequest, true);
  assert.equal(decision.debounceMs, 300);
});

test("immediate trigger after dot uses zero debounce", () => {
  const detector = new TriggerDetector();
  const decision = detector.evaluate(
    baseSettings(),
    baseContext({ afterDot: true, currentLinePrefix: "obj." }),
    autoTrigger()
  );
  assert.equal(decision.debounceMs, 0);
});

test("skips unchanged context hash", () => {
  const detector = new TriggerDetector();
  detector.markRequested("hash-a");
  const decision = detector.evaluate(baseSettings(), baseContext({ contextHash: "hash-a" }), autoTrigger());
  assert.equal(decision.shouldRequest, false);
  assert.equal(decision.reason, "unchanged_context");
});

test("retries unchanged context after cooldown", () => {
  const detector = new TriggerDetector();
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    detector.markRequested("hash-a");
    now += 1_001;
    const decision = detector.evaluate(
      baseSettings(),
      baseContext({ contextHash: "hash-a" }),
      autoTrigger()
    );
    assert.equal(decision.shouldRequest, true);
  } finally {
    Date.now = originalNow;
  }
});

test("failed request clears dedup for immediate retry", () => {
  const detector = new TriggerDetector();
  detector.markRequested("hash-a");
  detector.noteRequestFailed();
  const decision = detector.evaluate(
    baseSettings(),
    baseContext({ contextHash: "hash-a" }),
    autoTrigger()
  );
  assert.equal(decision.shouldRequest, true);
});

test("backoff after rejection suppresses requests", () => {
  const detector = new TriggerDetector();
  detector.noteRejection();
  const decision = detector.evaluate(baseSettings(), baseContext({ contextHash: "hash-b" }), autoTrigger());
  assert.equal(decision.shouldRequest, false);
  assert.equal(decision.reason, "backoff");
});

test("isImmediateTriggerLine detects property access and assignment", () => {
  assert.equal(isImmediateTriggerLine("const value = "), true);
  assert.equal(isImmediateTriggerLine("foo."), true);
  assert.equal(isImmediateTriggerLine("console.log"), false);
});

test("hot streak active uses reduced debounce", () => {
  const detector = new TriggerDetector();
  const decision = detector.evaluate(
    baseSettings(),
    baseContext({ currentLinePrefix: "console.log" }),
    autoTrigger(),
    { hotStreakActive: true, p95LatencyMs: 0 }
  );
  assert.equal(decision.shouldRequest, true);
  assert.ok(decision.debounceMs <= 50);
});

test("hot streak bypasses rapid typing suppression after accept", () => {
  const detector = new TriggerDetector();
  detector.noteKeystroke();
  const decision = detector.evaluate(
    baseSettings(),
    baseContext({ currentLinePrefix: "console.log", contextHash: "hash-after-accept" }),
    autoTrigger(),
    { hotStreakActive: true, p95LatencyMs: 0 }
  );
  assert.equal(decision.shouldRequest, true);
  assert.notEqual(decision.reason, "rapid_typing");
  assert.ok(decision.debounceMs <= 50);
});

test("immediate trigger after equals bypasses rapid typing", () => {
  const detector = new TriggerDetector();
  detector.noteKeystroke();
  const decision = detector.evaluate(
    baseSettings(),
    baseContext({ currentLinePrefix: "const value = ", contextHash: "hash-immediate" }),
    autoTrigger()
  );
  assert.equal(decision.shouldRequest, true);
  assert.equal(decision.debounceMs, 0);
  assert.notEqual(decision.reason, "rapid_typing");
});

test("rapid typing schedules debounced request instead of blocking", () => {
  const detector = new TriggerDetector();
  detector.noteKeystroke();
  const decision = detector.evaluate(
    baseSettings(),
    baseContext({ currentLinePrefix: "console.log", contextHash: "hash-rapid" }),
    autoTrigger()
  );
  assert.equal(decision.shouldRequest, true);
  assert.equal(decision.reason, "rapid_typing");
  assert.ok(decision.debounceMs > 0);
});

console.log(`\ntriggerDetector: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
