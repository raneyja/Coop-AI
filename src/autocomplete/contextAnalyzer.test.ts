import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import * as vscode from "vscode";
import { analyzeDocumentContext, isFileEligible, languageSpecificHints } from "./contextAnalyzer";
import { createMockDocument } from "./test/vscodeMockSetup";

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

test("analyzeDocumentContext extracts prefix and suffix", () => {
  const doc = createMockDocument("const value = 1;\nconsole.log(value);", {
    path: "/workspace/src/example.ts"
  });
  const position = new vscode.Position(0, 14);
  const context = analyzeDocumentContext(doc as never, position);
  assert.equal(context.currentLinePrefix, "const value = ");
  assert.equal(context.currentLineSuffix, "1;");
  assert.equal(context.suffixWindow, "1;\nconsole.log(value);");
  assert.equal(context.languageId, "typescript");
  assert.ok(context.contextHash.length > 0);
});

test("suffixWindow caps at 500 characters", () => {
  const doc = createMockDocument(
    "begin\n" + Array(30).fill("z".repeat(30)).join("\n"),
    { path: "/workspace/src/long.ts" }
  );
  const context = analyzeDocumentContext(doc as never, new vscode.Position(0, 5));
  assert.equal(context.suffixWindow.length, 500);
});

test("languageSpecificHints mentions property access after dot", () => {
  const context = analyzeDocumentContext(
    createMockDocument("obj.") as never,
    new vscode.Position(0, 4)
  );
  const hints = languageSpecificHints({ ...context, afterDot: true });
  assert.match(hints, /property access/i);
});

test("isFileEligible rejects markdown", () => {
  const doc = createMockDocument("# Title", { languageId: "markdown" });
  assert.equal(isFileEligible(doc as never), false);
});

test("isFileEligible rejects node_modules paths", () => {
  const doc = createMockDocument("export {}", {
    path: "/workspace/node_modules/pkg/index.js",
    languageId: "javascript"
  });
  assert.equal(isFileEligible(doc as never), false);
});

test("isFileEligible accepts typescript source files", () => {
  const doc = createMockDocument("export const x = 1;", {
    path: "/workspace/src/app.ts",
    languageId: "typescript"
  });
  assert.equal(isFileEligible(doc as never), true);
});

console.log(`\ncontextAnalyzer: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
