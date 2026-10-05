import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import { CoopAutocompleteProvider, registerAutocompleteIndexNotifier } from "./coopAutocompleteProvider";
import { analyzeDocumentContext } from "./contextAnalyzer";
import type { ExtractedCodeContext } from "./types";
import type * as vscode from "vscode";
import {
  createMockExtensionContext,
  getMockExecutedCommands,
  resetMockConfiguration,
  setMockConfiguration
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
  await asyncTest("switching repository while a completion is pending rejects the old result", async () => {
    let repoId = "gitlab:fixture/first";
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const provider = new CoopAutocompleteProvider({ api: {} as never, sessionProbe: () => ({ repoId }) });
    const document = {
      uri: { fsPath: "/fixture/service.ts", scheme: "file", toString: () => "file:///fixture/service.ts" },
      languageId: "typescript", getText: () => "const value = ;", offsetAt: () => 14
    } as unknown as vscode.TextDocument;
    const position = { line: 0, character: 14 } as vscode.Position;
    const extracted = analyzeDocumentContext(document, position);
    const harness = Object.assign(provider, {
      router: { fetchCompletions: (_context: unknown, _settings: unknown, _signal: unknown, _sample: unknown, options: { repoId?: string }) => {
        assert.equal(options.repoId, "gitlab:fixture/first");
        return pending;
      } },
      returnRankedInlineItems: () => [{ insertText: "old repository completion" }]
    }) as unknown as { executeRequest: (doc: vscode.TextDocument, pos: vscode.Position, context: ExtractedCodeContext) => Promise<unknown> };
    const result = harness.executeRequest(document, position, extracted);
    repoId = "github:fixture/second";
    finish({ completions: [{ text: "value;" }], latencyMs: 0, fromCache: false });
    assert.equal(await result, null);
    provider.dispose();
  });

  test("late completions preserve typing reuse but reject changed surrounding code", () => {
    const provider = new CoopAutocompleteProvider({ api: {} as never });
    const document = {
      uri: { fsPath: "/fixture/service.ts" }, languageId: "typescript",
      getText: () => "const value = ;", offsetAt: () => 14
    } as unknown as vscode.TextDocument;
    const requested = analyzeDocumentContext(document, { line: 0, character: 14 } as vscode.Position);
    const compatible = (provider as unknown as {
      isCompatibleCompletionContext: (a: ExtractedCodeContext, b: ExtractedCodeContext) => boolean
    }).isCompatibleCompletionContext.bind(provider);
    const extended = { ...requested, contextHash: "typed", currentLinePrefix: "const value = v" };
    assert.equal(compatible(requested, extended), true);
    for (const field of ["currentLineSuffix", "suffixWindow", "previousLines", "importsBlock", "parentSignature"] as const) {
      assert.equal(compatible(requested, { ...extended, [field]: "changed code" }), false, field);
    }
    provider.dispose();
  });

  await asyncTest("index notifier does not auto-enable autocomplete when index becomes healthy", async () => {
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

    assert.equal(getMockExecutedCommands().length, 0);
    assert.equal(context.globalState.get("coopAI.autocomplete.indexReadyToastShown"), true);
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
