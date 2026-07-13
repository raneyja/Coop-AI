import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import {
  fetchAfterDotMemberCompletions,
  filterMemberCompletionItems,
  isAfterDotMemberCompletionEligible,
  lspItemsToRankedCompletions,
  normalizeMemberInsertText,
  rankAfterDotLspMembers,
  resolveLspTriggerCharacter,
  stripSnippetPlaceholders
} from "./memberCompletionProvider";
import {
  createMockDocument,
  getMockExecutedCommands,
  resetMockConfiguration,
  setMockExecuteCommandHandler
} from "./test/vscodeMockSetup";
import type { ExtractedCodeContext } from "./types";

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

const baseContext: ExtractedCodeContext = {
  languageId: "typescript",
  filePath: "/workspace/src/example.ts",
  currentLinePrefix: "this.session.",
  currentLineSuffix: "",
  suffixWindow: "",
  previousLines: "",
  importsBlock: "",
  parentSignature: "",
  indent: "  ",
  cursorOffset: 20,
  contextHash: "hash",
  inComment: false,
  inString: false,
  afterDot: true,
  afterOpenParen: false,
  riskySyntax: false
};

test("isAfterDotMemberCompletionEligible requires afterDot and TS/JS language", () => {
  assert.equal(isAfterDotMemberCompletionEligible(baseContext), true);
  assert.equal(
    isAfterDotMemberCompletionEligible({ ...baseContext, afterDot: false }),
    false
  );
  assert.equal(
    isAfterDotMemberCompletionEligible({ ...baseContext, languageId: "python" }),
    false
  );
});

test("resolveLspTriggerCharacter returns dot for afterDot contexts", () => {
  assert.equal(resolveLspTriggerCharacter(baseContext), ".");
  assert.equal(resolveLspTriggerCharacter({ ...baseContext, afterDot: false }), undefined);
});

test("rankAfterDotLspMembers prioritizes createWebviewPanel on vscode.window", () => {
  const ranked = rankAfterDotLspMembers(
    [
      { text: "activeColorTheme", score: 1, source: "lsp" },
      { text: "createWebviewPanel(", score: 0.9, source: "lsp" },
      { text: "showInformationMessage(", score: 0.8, source: "lsp" }
    ],
    "    const panel = vscode.window."
  );
  assert.equal(ranked[0]?.text, "createWebviewPanel(");
});

test("stripSnippetPlaceholders removes VS Code snippet syntax", () => {
  assert.equal(stripSnippetPlaceholders("bindSession(${1:})"), "bindSession()");
  assert.equal(stripSnippetPlaceholders("foo($0)"), "foo()");
});

test("normalizeMemberInsertText keeps property names without parens", () => {
  const item = new vscode.CompletionItem("panel", vscode.CompletionItemKind.Property);
  assert.equal(normalizeMemberInsertText(item), "panel");
});

test("normalizeMemberInsertText adds parens for methods with snippet insert", () => {
  const item = new vscode.CompletionItem("bindSession", vscode.CompletionItemKind.Method);
  item.insertText = "bindSession(${1:})";
  assert.equal(normalizeMemberInsertText(item), "bindSession(");
});

test("filterMemberCompletionItems drops classes and keywords", () => {
  const members = filterMemberCompletionItems([
    new vscode.CompletionItem("panel", vscode.CompletionItemKind.Property),
    new vscode.CompletionItem("Session", vscode.CompletionItemKind.Class),
    new vscode.CompletionItem("import", vscode.CompletionItemKind.Keyword)
  ]);
  assert.equal(members.length, 1);
  assert.equal(typeof members[0]?.label === "string" ? members[0].label : members[0]?.label.label, "panel");
});

test("lspItemsToRankedCompletions dedupes and tags source lsp", () => {
  const ranked = lspItemsToRankedCompletions([
    new vscode.CompletionItem("panel", vscode.CompletionItemKind.Property),
    new vscode.CompletionItem("panel", vscode.CompletionItemKind.Property),
    new vscode.CompletionItem("bindSession", vscode.CompletionItemKind.Method)
  ]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.source, "lsp");
  assert.equal(ranked[0]?.text, "panel");
  assert.equal(ranked[1]?.text, "bindSession(");
});

void (async () => {
  await asyncTest("fetchAfterDotMemberCompletions calls VS Code completion provider", async () => {
    setMockExecuteCommandHandler(async (command, uri, position, triggerCharacter) => {
      assert.equal(command, "vscode.executeCompletionItemProvider");
      assert.equal(triggerCharacter, ".");
      assert.ok(uri);
      assert.ok(position);
      return [
        new vscode.CompletionItem("bindSession", vscode.CompletionItemKind.Method),
        new vscode.CompletionItem("panel", vscode.CompletionItemKind.Property)
      ];
    });

    const document = createMockDocument("this.session.", { languageId: "typescript" });
    const position = new vscode.Position(0, 13);
    const ranked = await fetchAfterDotMemberCompletions(document as never, position, baseContext);

    assert.equal(getMockExecutedCommands().length, 1);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0]?.text, "bindSession(");
    assert.equal(ranked[1]?.text, "panel");
  });

  await asyncTest("fetchAfterDotMemberCompletions skips non-eligible contexts", async () => {
    setMockExecuteCommandHandler(async () => {
      throw new Error("should not call LSP");
    });

    const document = createMockDocument("const x = 1", { languageId: "typescript" });
    const position = new vscode.Position(0, 11);
    const ranked = await fetchAfterDotMemberCompletions(
      document as never,
      position,
      { ...baseContext, afterDot: false }
    );

    assert.equal(ranked.length, 0);
    assert.equal(getMockExecutedCommands().length, 0);
  });

  await asyncTest("fetchAfterDotMemberCompletions fails open on command errors", async () => {
    setMockExecuteCommandHandler(async () => {
      throw new Error("language server unavailable");
    });

    const document = createMockDocument("this.session.", { languageId: "typescript" });
    const position = new vscode.Position(0, 13);
    const ranked = await fetchAfterDotMemberCompletions(document as never, position, baseContext);
    assert.equal(ranked.length, 0);
  });

  await asyncTest("fetchAfterDotMemberCompletions fails open on timeout", async () => {
    setMockExecuteCommandHandler(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve([new vscode.CompletionItem("late", vscode.CompletionItemKind.Property)]),
            50
          );
        })
    );

    const document = createMockDocument("this.session.", { languageId: "typescript" });
    const position = new vscode.Position(0, 13);
    const ranked = await fetchAfterDotMemberCompletions(document as never, position, baseContext, {
      timeoutMs: 5
    });
    assert.equal(ranked.length, 0);
  });

  console.log(`\nmemberCompletionProvider: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
})();
