import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CoopAutocompleteProvider } from "./coopAutocompleteProvider";
import {
  getMockExecutedCommands,
  resetMockConfiguration,
  setMockConfiguration
} from "./test/vscodeMockSetup";
import {
  nesAllowsDiskWalk,
  NextEditController,
  planNesAfterAccept,
  predictNextEditLocation,
  resolveNesContextSources,
  shouldIssueNesRequest
} from "./nextEditSuggestions";
import { mayReadLocalRepoDiskForIntelligence } from "../workspace/zeroClonePolicy";
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

function mockApi(): SecureApiClient {
  return {
    recordUsageEvents: async () => undefined,
    streamInlineCompletion: async () => ({ text: "", alternatives: [], model: "x", provider: "x" })
  } as unknown as SecureApiClient;
}

test("E-P1 setting off → zero NES requests after Tab-accept", () => {
  const nes = new NextEditController();
  for (let i = 0; i < 8; i += 1) {
    nes.armAfterTabAccept("hello");
    assert.equal(nes.shouldRequest(false), false);
  }
  assert.equal(nes.getRequestCount(), 0);

  const provider = new CoopAutocompleteProvider({ api: mockApi() });
  for (let i = 0; i < 5; i += 1) {
    provider.noteSuggestionAccepted(`hash-${i}`, "typescript");
  }
  assert.equal(provider.getNesDebugState().requestCount, 0);
  assert.equal(getMockExecutedCommands().length, 0);
  provider.dispose();
});

test("E-P2 rapid typing / throttle does not storm NES requests", () => {
  const nes = new NextEditController();
  nes.armAfterTabAccept("hello");
  for (let i = 0; i < 20; i += 1) {
    nes.noteKeystroke();
  }
  assert.equal(nes.isArmed(), false);
  assert.equal(
    shouldIssueNesRequest({
      nesEnabled: true,
      afterTabAccept: nes.isArmed(),
      throttleBlocked: nes.isThrottleBlocked(),
      alreadyInFlight: nes.isInFlight()
    }),
    false
  );
  assert.equal(nes.getRequestCount(), 0);

  const once = new NextEditController();
  once.armAfterTabAccept("hello");
  const prediction = predictNextEditLocation(["hello();", "hello();"], {
    line: 0,
    character: 7,
    insertedText: "hello"
  });
  assert.ok(prediction);
  once.beginRequest(prediction!);
  once.finishRequest();
  assert.ok(once.getRequestCount() <= 1);
});

test("E-P3 remote Use-repo: NES context is graph/API + buffer, never a clone walk", () => {
  assert.equal(mayReadLocalRepoDiskForIntelligence(), false);
  assert.equal(nesAllowsDiskWalk(), false);
  assert.deepEqual([...resolveNesContextSources()], ["buffer", "graph-api"]);

  const source = readFileSync(join(__dirname, "nextEditSuggestions.ts"), "utf8");
  for (const banned of [
    "workspace.findFiles",
    "workspaceFolders",
    "readWorkspaceFileFromDisk",
    "readLocalWorkspaceFiles"
  ]) {
    assert.equal(source.includes(banned), false, `NES module must not reference ${banned}`);
  }

  const plan = planNesAfterAccept({
    nesEnabled: true,
    lines: ["export function auth() {}", "export function requireAuth() {}"],
    cursor: { line: 0, character: 24 },
    insertedText: "auth"
  });
  assert.equal(plan.kind, "nes");
  if (plan.kind === "nes") {
    assert.ok(!plan.contextSources.includes("disk" as never));
  }
});

test("E-P4 Escape / reject NES is counted and does not brick Tab", () => {
  const nes = new NextEditController();
  nes.armAfterTabAccept("hello");
  const prediction = predictNextEditLocation(["hello();", "hello();"], {
    line: 0,
    character: 7,
    insertedText: "hello"
  });
  assert.ok(prediction);
  nes.beginRequest(prediction!);
  nes.markShown();
  nes.finishRequest();
  nes.markRejected();
  assert.equal(nes.getRejectCount(), 1);
  assert.equal(nes.wasLastShownNes(), false);

  nes.armAfterTabAccept("hello");
  assert.equal(nes.shouldRequest(true), true);

  setMockConfiguration("coopAI.autocomplete", "nextEditSuggestions", true);
  const provider = new CoopAutocompleteProvider({ api: mockApi() });
  provider.noteSuggestionAccepted("hash-tab", "typescript");
  assert.equal(provider.getNesDebugState().armed, true);
  provider.noteSuggestionRejected("dismissed", "typescript");
  provider.noteSuggestionAccepted("hash-tab-2", "typescript");
  assert.equal(provider.getNesDebugState().armed, true);
  provider.dispose();
});

console.log(`\nphaseE.pressure: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
