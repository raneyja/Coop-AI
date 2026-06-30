import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import {
  filterAndRankCompletions,
  normalizeCompletionText,
  stripOverlapWithPrefix,
  toInlineInsertText
} from "./completionFilter";
import type { AutocompleteSettings, ExtractedCodeContext, RankedCompletion } from "./types";

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

const settings: AutocompleteSettings = {
  enabled: true,
  trigger: "auto",
  maxSuggestionLength: 200,
  debounceMs: 300,
  model: "haiku",
  customModel: "",
  copilotPolicy: "warn",
  showMultipleSuggestions: false,
  requestTimeoutMs: 400,
  useFim: true
};

const context: ExtractedCodeContext = {
  languageId: "typescript",
  filePath: "/workspace/src/example.ts",
  currentLinePrefix: "const value = ",
  currentLineSuffix: "",
  previousLines: "",
  importsBlock: "",
  parentSignature: "",
  indent: "  ",
  cursorOffset: 20,
  contextHash: "hash",
  inComment: false,
  inString: false,
  afterDot: false,
  afterOpenParen: false,
  riskySyntax: false
};

test("normalizeCompletionText strips markdown fences", () => {
  assert.equal(normalizeCompletionText("```ts\nhello();\n```"), "hello();");
});

test("filterAndRankCompletions drops trivial completions", () => {
  const ranked = filterAndRankCompletions([";", "  "], context, settings);
  assert.equal(ranked.length, 0);
});

test("filterAndRankCompletions keeps valid completion", () => {
  const ranked = filterAndRankCompletions(['"hello";'], context, settings);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.text, '"hello";');
});

test("stripOverlapWithPrefix removes shared suffix", () => {
  assert.equal(stripOverlapWithPrefix("const val", "value = 1"), "ue = 1");
});

test("toInlineInsertText applies indent on blank line", () => {
  const blankLineContext = { ...context, currentLinePrefix: "", indent: "  " };
  const completion: RankedCompletion = { text: "return true;", score: 1, source: "llm" };
  assert.equal(toInlineInsertText(blankLineContext, completion), "  return true;");
});

console.log(`\ncompletionFilter: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
