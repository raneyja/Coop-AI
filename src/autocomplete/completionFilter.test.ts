import "./test/vscodeMockSetup";
import assert from "node:assert/strict";
import {
  buildKnownSymbolsFromContext,
  ensureInsertSpacing,
  filterAndRankCompletions,
  normalizeCompletionText,
  sanitizeCompletionForContext,
  stripOverlapWithPrefix,
  symbolPlausibilityAdjustment,
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
  showMultipleSuggestions: false,
  requestTimeoutMs: 400,
  useFim: true
};

const context: ExtractedCodeContext = {
  languageId: "typescript",
  filePath: "/workspace/src/example.ts",
  currentLinePrefix: "const value = ",
  currentLineSuffix: "",
  suffixWindow: "",
  previousLines: "",
  importsBlock: "import { createSessionId } from './session';",
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

test("filterAndRankCompletions drops mismatched string quotes", () => {
  const ranked = filterAndRankCompletions(["'sessionId\" in state"], context, settings);
  assert.equal(ranked.length, 0);
});

test("filterAndRankCompletions keeps valid completion", () => {
  const ranked = filterAndRankCompletions(['"hello";'], context, settings);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.text, '"hello";');
});

test("filterAndRankCompletions strips redundant const from mid-assignment", () => {
  const ranked = filterAndRankCompletions(
    ["const sessionId = options?.sessionId || createSessionId();"],
    context,
    settings
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.text, "options?.sessionId || createSessionId();");
});

test("filterAndRankCompletions keeps rhs after stripping duplicate declaration", () => {
  const ranked = filterAndRankCompletions(["const foo = 1;"], context, settings);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.text, "1;");
});

test("filterAndRankCompletions drops function restart mid-assignment", () => {
  const ranked = filterAndRankCompletions(
    ["function helper() { return 1; }"],
    context,
    settings
  );
  assert.equal(ranked.length, 0);
});

test("filterAndRankCompletions allows const on fresh indented line", () => {
  const freshLine = { ...context, currentLinePrefix: "  ", suffixWindow: "" };
  const ranked = filterAndRankCompletions(["const next = 1;"], freshLine, settings);
  assert.equal(ranked.length, 1);
});

test("sanitizeCompletionForContext extracts rhs only", () => {
  assert.equal(
    sanitizeCompletionForContext("const sessionId = options?.id;", context),
    "options?.id;"
  );
});

test("stripOverlapWithPrefix removes shared suffix", () => {
  assert.equal(stripOverlapWithPrefix("const val", "value = 1"), "ue = 1");
});

test("toInlineInsertText adds space after assignment when cursor is right of equals", () => {
  const noSpaceContext = { ...context, currentLinePrefix: "const value =" };
  const completion: RankedCompletion = {
    text: "options?.sessionId || createSessionId();",
    score: 1,
    source: "llm"
  };
  assert.equal(
    toInlineInsertText(noSpaceContext, completion),
    " options?.sessionId || createSessionId();"
  );
});

test("ensureInsertSpacing is no-op when prefix already has trailing space", () => {
  assert.equal(
    ensureInsertSpacing("const value = ", "options?.id;"),
    "options?.id;"
  );
});

test("toInlineInsertText applies indent on blank line", () => {
  const blankLineContext = { ...context, currentLinePrefix: "", indent: "  " };
  const completion: RankedCompletion = { text: "return true;", score: 1, source: "llm" };
  assert.equal(toInlineInsertText(blankLineContext, completion), "  return true;");
});

test("buildKnownSymbolsFromContext includes imports and builtins", () => {
  const known = buildKnownSymbolsFromContext(context);
  assert.ok(known.has("createSessionId"));
  assert.ok(known.has("Promise"));
});

test("filterAndRankCompletions prefers manifest-known symbols", () => {
  const manifestSymbols = new Set(["createSessionId", "SessionStore"]);
  const ranked = filterAndRankCompletions(
    [
      "TotallyUnknownService.doThing();",
      "createSessionId();"
    ],
    context,
    settings,
    undefined,
    { manifestSymbols }
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.text, "createSessionId();");
});

test("filterAndRankCompletions ranks known symbols above unknown when both kept", () => {
  const manifestSymbols = new Set(["createSessionId", "SessionStore"]);
  const ranked = filterAndRankCompletions(
    [
      "UnknownWidget();",
      "createSessionId();"
    ],
    { ...context, importsBlock: "" },
    { ...settings, showMultipleSuggestions: true },
    "function helper() {}",
    { manifestSymbols }
  );
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0]?.text, "createSessionId();");
});

test("symbolPlausibilityAdjustment penalizes unknown identifiers", () => {
  const penalty = symbolPlausibilityAdjustment(
    "UnknownWidget.process();",
    context,
    undefined,
    { manifestSymbols: new Set(["createSessionId"]) }
  );
  assert.ok(penalty < 0);
});

test("symbolPlausibilityAdjustment rewards known identifiers", () => {
  const bonus = symbolPlausibilityAdjustment("createSessionId();", context, undefined, {
    manifestSymbols: new Set(["createSessionId"])
  });
  assert.ok(bonus > 0);
});

console.log(`\ncompletionFilter: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
