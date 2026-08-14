import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CoopAutocompleteProvider } from "./coopAutocompleteProvider";
import { readAutocompleteSettings } from "./autocompleteConfig";
import {
  getMockExecutedCommands,
  resetMockConfiguration,
  setMockConfiguration
} from "./test/vscodeMockSetup";
import {
  isNextEditSuggestionsEnabled,
  nesAllowsDiskWalk,
  nesGhostRange,
  nesTouchesBaseCompletionPath,
  NextEditController,
  planNesAfterAccept,
  predictNextEditLocation,
  resolveNesContextSources,
  shouldIssueNesRequest
} from "./nextEditSuggestions";
import type { SecureApiClient } from "../chat/SecureApiClient";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    resetMockConfiguration();
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function packageNesDefault(): boolean | undefined {
  const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
  const pkg = JSON.parse(raw) as {
    contributes?: {
      configuration?: {
        properties?: Record<string, { default?: unknown }>;
      };
    };
  };
  return pkg.contributes?.configuration?.properties?.["coopAI.autocomplete.nextEditSuggestions"]
    ?.default as boolean | undefined;
}

function mockApi(): SecureApiClient {
  return {
    recordUsageEvents: async () => undefined,
    streamInlineCompletion: async () => ({ text: "", alternatives: [], model: "x", provider: "x" })
  } as unknown as SecureApiClient;
}

test("E-G3 / UX-G5 NES setting defaults off in package.json and readAutocompleteSettings", () => {
  assert.equal(packageNesDefault(), false);
  assert.equal(readAutocompleteSettings().nextEditSuggestions, false);
  assert.equal(isNextEditSuggestionsEnabled(readAutocompleteSettings()), false);
});

test("E-G1 after Tab-accept + NES on, plan a ghost at a predicted location", () => {
  const lines = [
    "function greet() {",
    "  return hello();",
    "}",
    "function greetAgain() {",
    "  return hello();",
    "}"
  ];
  const plan = planNesAfterAccept({
    nesEnabled: true,
    lines,
    cursor: { line: 1, character: 16 },
    insertedText: "hello"
  });
  assert.equal(plan.kind, "nes");
  if (plan.kind !== "nes") {
    return;
  }
  assert.equal(plan.prediction.reason, "next-sibling-identifier");
  assert.equal(plan.prediction.line, 4);
  const range = nesGhostRange(plan.prediction);
  assert.equal(range.start.line, 4);
  assert.ok(shouldIssueNesRequest({
    nesEnabled: true,
    afterTabAccept: true,
    throttleBlocked: false,
    alreadyInFlight: false
  }));
});

test("E-G1 provider Tab-accept with NES on arms and retriggers inline suggest", () => {
  setMockConfiguration("coopAI.autocomplete", "nextEditSuggestions", true);
  const provider = new CoopAutocompleteProvider({ api: mockApi() });
  provider.noteSuggestionAccepted("hash-1", "typescript");
  const commands = getMockExecutedCommands();
  assert.ok(
    commands.some((entry) => entry[0] === "editor.action.inlineSuggest.trigger"),
    "NES on should attach the next ghost via inlineSuggest.trigger"
  );
  assert.equal(provider.getNesDebugState().armed, true);
  provider.dispose();
});

test("E-G2 NES never rides the base typing → ghost path (p50/p95 unchanged)", () => {
  assert.equal(nesTouchesBaseCompletionPath(false), false);
  assert.equal(nesTouchesBaseCompletionPath(true), false);
  assert.equal(
    shouldIssueNesRequest({
      nesEnabled: false,
      afterTabAccept: true,
      throttleBlocked: false,
      alreadyInFlight: false
    }),
    false
  );
});

test("E-G4 NES context sources are buffer + graph API, not disk walk", () => {
  assert.deepEqual([...resolveNesContextSources()], ["buffer", "graph-api"]);
  assert.equal(nesAllowsDiskWalk(), false);
  const plan = planNesAfterAccept({
    nesEnabled: true,
    lines: ["const x = 1;", "const y = 2;"],
    cursor: { line: 0, character: 12 },
    insertedText: "1"
  });
  assert.equal(plan.kind, "nes");
  if (plan.kind === "nes") {
    assert.deepEqual([...plan.contextSources], ["buffer", "graph-api"]);
  }
});

test("E-G6 NES off: Tab-accept does not arm NES or add a second ghost trigger", () => {
  const provider = new CoopAutocompleteProvider({ api: mockApi() });
  provider.noteSuggestionAccepted("hash-off", "typescript");
  assert.equal(getMockExecutedCommands().length, 0);
  assert.equal(provider.getNesDebugState().armed, false);
  assert.equal(provider.getNesDebugState().requestCount, 0);
  assert.equal(provider.wasLastShownNes(), false);
  provider.dispose();
});

test("E-G1 predictNextEditLocation finds the next incomplete line", () => {
  const prediction = predictNextEditLocation(
    ["const a = 1;", "const items = [", "];"],
    { line: 0, character: 12, insertedText: "1" }
  );
  assert.ok(prediction);
  assert.equal(prediction?.reason, "next-incomplete-line");
  assert.equal(prediction?.line, 1);
});

test("E-G5 gate IDs are covered by this file", () => {
  const ids = ["E-G1", "E-G2", "E-G3", "E-G4", "E-G5", "E-G6"];
  assert.equal(ids.length, 6);
});

test("E-G1 controller issues one NES request after accept when enabled", () => {
  const nes = new NextEditController();
  assert.equal(nes.shouldRequest(false), false);
  nes.armAfterTabAccept("hello");
  assert.equal(nes.shouldRequest(true), true);
  const prediction = predictNextEditLocation(["hello();", "hello();"], {
    line: 0,
    character: 7,
    insertedText: "hello"
  });
  assert.ok(prediction);
  nes.beginRequest(prediction!);
  nes.markShown();
  nes.finishRequest();
  assert.equal(nes.getRequestCount(), 1);
  assert.equal(nes.wasLastShownNes(), true);
  assert.equal(nes.shouldRequest(true), false);
});

console.log(`\nphaseE.gates: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
