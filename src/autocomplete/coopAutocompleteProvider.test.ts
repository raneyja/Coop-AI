import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import { registerAutocompleteIndexNotifier } from "./coopAutocompleteProvider";
import {
  createMockExtensionContext,
  getMockExecutedCommands,
  resetMockConfiguration,
  setMockConfiguration,
  setMockInformationMessageChoice
} from "./test/vscodeMockSetup";
import type { IndexBackend, IndexRepoStatus } from "../indexing/indexBackend";

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

async function asyncTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    resetMockConfiguration();
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function createMockIndexBackend(statuses: IndexRepoStatus[]): IndexBackend {
  return {
    kind: "local",
    isEnabledForRepo: async () => true,
    enableRepo: async () => statuses[0]!,
    disableRepo: async () => undefined,
    refreshRepo: async () => statuses[0]!,
    getRepoStatus: async () => statuses[0],
    listRepoStatuses: async () => statuses,
    search: async () => ({ matches: [], total: 0 }),
    dependents: async () => ({ dependents: [] }),
    summarize: async () => ({
      enabledRepos: statuses.length,
      totalDiskBytes: 0,
      readyRepos: statuses.filter((s) => s.status === "ready").length,
      indexingRepos: 0
    })
  };
}

const readyStatus: IndexRepoStatus = {
  repoId: "github:acme/widgets",
  enabled: true,
  status: "ready",
  zoektAvailable: true,
  scipAvailable: false
};

void (async () => {
  await asyncTest("index notifier auto-enables autocomplete globally when index becomes healthy", async () => {
    setMockConfiguration("coopAI.autocomplete", "enabled", false);
    setMockConfiguration("coopAI", "defaultOwner", "acme");
    setMockConfiguration("coopAI", "defaultRepo", "widgets");

    const context = createMockExtensionContext();
    const disposable = registerAutocompleteIndexNotifier(
      context,
      createMockIndexBackend([readyStatus])
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    disposable.dispose();

    const commands = getMockExecutedCommands();
    assert.equal(commands.length, 1);
    assert.equal(commands[0]?.[0], "coopAI.setAutocompleteEnabled");
    assert.equal(commands[0]?.[1], true);
    assert.equal(context.globalState.get("coopAI.autocomplete.indexReadyToastShown"), true);
  });

  await asyncTest("index notifier Turn off disables autocomplete globally", async () => {
    setMockConfiguration("coopAI.autocomplete", "enabled", false);
    setMockConfiguration("coopAI", "defaultOwner", "acme");
    setMockConfiguration("coopAI", "defaultRepo", "widgets");
    setMockInformationMessageChoice("Turn off");

    const context = createMockExtensionContext();
    const disposable = registerAutocompleteIndexNotifier(
      context,
      createMockIndexBackend([readyStatus])
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    disposable.dispose();

    const commands = getMockExecutedCommands();
    assert.equal(commands.length, 2);
    assert.equal(commands[0]?.[1], true);
    assert.equal(commands[1]?.[0], "coopAI.setAutocompleteEnabled");
    assert.equal(commands[1]?.[1], false);
  });

  await asyncTest("index notifier skips when user previously disabled autocomplete", async () => {
    setMockConfiguration("coopAI", "defaultOwner", "acme");
    setMockConfiguration("coopAI", "defaultRepo", "widgets");
    const context = createMockExtensionContext();
    await context.globalState.update("coopAI.autocomplete.userDisabled", true);

    const disposable = registerAutocompleteIndexNotifier(
      context,
      createMockIndexBackend([readyStatus])
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    disposable.dispose();

    assert.equal(getMockExecutedCommands().length, 0);
  });

  await asyncTest("index notifier no-ops when discovery already shown", async () => {
    const context = createMockExtensionContext();
    await context.globalState.update("coopAI.autocomplete.indexReadyToastShown", true);
    const disposable = registerAutocompleteIndexNotifier(
      context,
      createMockIndexBackend([readyStatus])
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    disposable.dispose();
    assert.equal(getMockExecutedCommands().length, 0);
  });

  await asyncTest("index notifier leaves enabled setting unchanged when already on", async () => {
    setMockConfiguration("coopAI.autocomplete", "enabled", true);
    setMockConfiguration("coopAI", "defaultOwner", "acme");
    setMockConfiguration("coopAI", "defaultRepo", "widgets");

    const context = createMockExtensionContext();
    const disposable = registerAutocompleteIndexNotifier(
      context,
      createMockIndexBackend([readyStatus])
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    disposable.dispose();
    assert.equal(getMockExecutedCommands().length, 0);
  });

  console.log(`\ncoopAutocompleteProvider: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
})();
