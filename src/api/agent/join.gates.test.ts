/**
 * Join gates — automated subset of J-G1..G8.
 * Manual Extension Host rows stay on Jon's S1–S14 scorecard.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { JOIN_GATE_IDS } from "./gates";
import { shouldRunAgentToolLoop } from "../../chat/agentRouting";
import { planChatIntentFromRules } from "../../chat/intentPlanner/planChatIntent";

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

function readRepo(...parts: string[]): string {
  return fs.readFileSync(path.join(__dirname, "../../..", ...parts), "utf8");
}

test("J-G1 Apply session wires Create PR (canCreatePr + patch:create-pr handler)", () => {
  assert.ok(JOIN_GATE_IDS.includes("J-G1"));
  const session = readRepo("src/chat/CoopChatSession.ts");
  assert.match(session, /patch:create-pr/);
  assert.match(session, /patch:pr-created/);

  const actions = readRepo("src/edit/patchActions.ts");
  assert.match(actions, /canCreatePr:\s*prFiles\.length\s*>\s*0/);

  const types = readRepo("src/chat/types.ts");
  assert.match(types, /canCreatePr\?:/);

  const contract = readRepo("src/edit/patchSessionContract.ts");
  assert.match(contract, /canCreatePr/);
});

test("J-G3 test:agent-ship and test:agent-ship:pressure scripts exist", () => {
  const pkg = JSON.parse(readRepo("package.json")) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts["test:agent-ship"]?.includes("test:agent-ship:a"));
  assert.ok(pkg.scripts["test:agent-ship:pressure"]);
  assert.ok(pkg.scripts["test:agent-ship:a"]);
  assert.ok(pkg.scripts["test:agent-ship:b"]);
  assert.ok(pkg.scripts["test:agent-enterprise"]);
});

test("J-G4 quick actions never enter the agent tool loop", () => {
  for (const q of [
    "trace the decision for this auth change",
    "who owns the billing service",
    "blast radius of requireAuth",
    "understand this repo",
    "knowledge gaps in auth"
  ]) {
    assert.equal(
      shouldRunAgentToolLoop({
        query: q,
        hasQuickAction: true,
        intentPlan: planChatIntentFromRules({ message: q, connectedTools: [] })
      }),
      false,
      q
    );
  }
});

test("J-G6 Agent hunts always on (no user toggle); NES stays off", () => {
  const pkg = JSON.parse(readRepo("package.json")) as {
    contributes: { configuration: { properties: Record<string, { default?: unknown }> } };
  };
  assert.equal(pkg.contributes.configuration.properties["coopAI.chat.agentMode"], undefined);

  const nesKey = "coopAI.autocomplete.nextEditSuggestions";
  assert.equal(pkg.contributes.configuration.properties[nesKey]?.default, false);

  const settingsView = readRepo("src/webview/SettingsView.tsx");
  assert.doesNotMatch(settingsView, /agentMode:/);
});

test("J-G7 chat-intent script exists for UX freeze regression", () => {
  const pkg = JSON.parse(readRepo("package.json")) as { scripts: Record<string, string> };
  assert.ok(pkg.scripts["test:chat-intent"]);
});

console.log(`\njoin.gates: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
