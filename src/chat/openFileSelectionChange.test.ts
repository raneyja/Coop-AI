import assert from "node:assert/strict";
import { agentTurnAction, shouldRunAgentToolLoop } from "./agentRouting";
import { agentOwnsIndexedGather } from "../context/committedActivity";
import { emptyChatIntentPlan } from "./intentPlanner/types";
import { openFileSelectionOwnsChange, stripInsertSpec } from "./openFileSelectionChange";

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

const chip = {
  file: ".dockerignore",
  selectedLines: [11, 11] as [number, number]
};

test("R file + live line + add a comment owns the change", () => {
  assert.equal(
    openFileSelectionOwnsChange({
      ...chip,
      message: "add a comment that says testest"
    }),
    true
  );
});

for (const message of ["put a note here", "write this above it", "insert a line"]) {
  test(`same route for wording: ${message}`, () => {
    assert.equal(openFileSelectionOwnsChange({ ...chip, message }), true);
  });
}

test("question on the highlight does not own the change", () => {
  assert.equal(
    openFileSelectionOwnsChange({ ...chip, message: "what does this do?" }),
    false
  );
});

test("named other symbol still hunts", () => {
  assert.equal(
    openFileSelectionOwnsChange({
      ...chip,
      message: "add a guard to `requireAuth`"
    }),
    false
  );
});

test("lowercase other symbol without backticks still hunts", () => {
  assert.equal(
    openFileSelectionOwnsChange({
      ...chip,
      message: "add a guard to requireauth"
    }),
    false
  );
});

test("repo-wide rename does not own the open file", () => {
  assert.equal(
    openFileSelectionOwnsChange({
      ...chip,
      message: "Rename verifyToken across the repo"
    }),
    false
  );
});

test("no live selection does not own the change", () => {
  assert.equal(
    openFileSelectionOwnsChange({
      file: ".dockerignore",
      message: "add a comment that says testest"
    }),
    false
  );
});

test("/edit and quick actions stay with their owners", () => {
  assert.equal(
    openFileSelectionOwnsChange({
      ...chip,
      message: "add a comment that says testest",
      explicitEdit: true
    }),
    false
  );
  assert.equal(
    openFileSelectionOwnsChange({
      ...chip,
      message: "add a comment that says testest",
      hasQuickAction: true
    }),
    false
  );
  assert.equal(
    openFileSelectionOwnsChange({
      ...chip,
      message: "add a comment that says testest",
      integrationSlash: true
    }),
    false
  );
});

test("quoted insert text and that-said spans are not hunt symbols", () => {
  assert.equal(stripInsertSpec('add a comment that said requireAuth').includes("requireAuth"), false);
  assert.equal(
    openFileSelectionOwnsChange({
      ...chip,
      message: 'add a comment that said requireAuth'
    }),
    true
  );
  assert.equal(
    openFileSelectionOwnsChange({
      ...chip,
      message: 'add a comment that says "requireAuth"'
    }),
    true
  );
});

test("ship-check on a highlight still does not own the change", () => {
  assert.equal(
    openFileSelectionOwnsChange({
      ...chip,
      message: "If I change that missing-key response, what else should I check?"
    }),
    false
  );
});

const changePlan = {
  ...emptyChatIntentPlan("add a comment that says testest"),
  mode: "none" as const,
  codeIntent: {
    action: "change" as const,
    confidence: "high" as const,
    reason: "change request"
  }
};

test("highlight + change does not enter the agent loop", () => {
  const options = {
    query: "add a comment that says testest",
    hasQuickAction: false,
    intentPlan: changePlan,
    file: ".dockerignore",
    selectedLines: [11, 11] as [number, number]
  };
  assert.equal(agentTurnAction(options), "none");
  assert.equal(shouldRunAgentToolLoop(options), false);
  assert.equal(
    agentOwnsIndexedGather({
      fileAssistant: false,
      hasQuickAction: false,
      isEditTurn: false,
      agentAction: agentTurnAction(options),
      skipOpenFileFeatureAdd: false,
      honestRepoScope: true,
      repoId: "github:raneyja/Coop-AI"
    }),
    false
  );
});

test("named other symbol with a highlight still runs the agent loop", () => {
  const options = {
    query: "add a guard to requireauth",
    hasQuickAction: false,
    file: ".dockerignore",
    selectedLines: [11, 11] as [number, number]
  };
  assert.equal(agentTurnAction(options), "change");
  assert.equal(shouldRunAgentToolLoop(options), true);
  assert.equal(
    agentOwnsIndexedGather({
      fileAssistant: false,
      hasQuickAction: false,
      isEditTurn: false,
      agentAction: "change",
      skipOpenFileFeatureAdd: false,
      honestRepoScope: true,
      repoId: "github:raneyja/Coop-AI"
    }),
    true
  );
});

test("change with no selection still runs the agent loop", () => {
  const options = {
    query: "add a comment that says testest",
    hasQuickAction: false,
    intentPlan: changePlan,
    file: ".dockerignore"
  };
  assert.equal(agentTurnAction(options), "change");
  assert.equal(shouldRunAgentToolLoop(options), true);
});

test("question on a highlight is not this choke and keeps today's route", () => {
  const short = "what does this do?";
  assert.equal(openFileSelectionOwnsChange({ ...chip, message: short }), false);
  assert.equal(
    agentTurnAction({
      query: short,
      hasQuickAction: false,
      file: chip.file,
      selectedLines: chip.selectedLines
    }),
    agentTurnAction({ query: short, hasQuickAction: false, file: chip.file })
  );
  const explain = "what does the highlighted code do?";
  const explainOptions = {
    query: explain,
    hasQuickAction: false,
    file: chip.file,
    selectedLines: chip.selectedLines
  };
  assert.equal(openFileSelectionOwnsChange({ ...chip, message: explain }), false);
  assert.equal(agentTurnAction(explainOptions), "understand");
  assert.equal(shouldRunAgentToolLoop(explainOptions), true);
});

test("L file-assistant still skips the agent loop", () => {
  assert.equal(
    shouldRunAgentToolLoop({
      query: "add a comment that says hello",
      hasQuickAction: false,
      fileAssistant: true,
      file: "/Users/me/Desktop/notes.ts",
      selectedLines: [3, 3]
    }),
    false
  );
});

console.log(`\nopenFileSelectionChange: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
