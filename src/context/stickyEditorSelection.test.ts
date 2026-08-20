import assert from "node:assert/strict";
import {
  resolveStickySelectedLines,
  selectedLineRangesEqual,
  selectedLinesFromEditorSelection
} from "./stickyEditorSelection";

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

test("selectedLinesFromEditorSelection maps 0-based L56–61 inclusive", () => {
  const range = selectedLinesFromEditorSelection({
    isEmpty: false,
    start: { line: 55, character: 0 },
    end: { line: 60, character: 24 }
  });
  assert.deepEqual(range, [56, 61]);
});

test("selectedLinesFromEditorSelection treats col-0 end as exclusive next line", () => {
  const range = selectedLinesFromEditorSelection({
    isEmpty: false,
    start: { line: 55, character: 0 },
    end: { line: 61, character: 0 }
  });
  assert.deepEqual(range, [56, 61]);
});

test("selectedLinesFromEditorSelection ignores empty caret", () => {
  assert.equal(
    selectedLinesFromEditorSelection({
      isEmpty: true,
      start: { line: 55, character: 0 },
      end: { line: 55, character: 0 }
    }),
    undefined
  );
});

test("sticky keeps L56–61 when Chat click sends empty selection on same file", () => {
  const next = resolveStickySelectedLines({
    existingFile: "apps/api/plane/db/models/state.py",
    existingLines: [56, 61],
    incomingFile: "apps/api/plane/db/models/state.py",
    incomingLines: undefined
  });
  assert.deepEqual(next, [56, 61]);
});

test("sticky keeps L56–61 when incoming file is omitted (webview focus loss)", () => {
  const next = resolveStickySelectedLines({
    existingFile: "apps/api/plane/db/models/state.py",
    existingLines: [56, 61],
    incomingFile: undefined,
    incomingLines: undefined
  });
  assert.deepEqual(next, [56, 61]);
});

test("sticky replaces the range when the user highlights a new block", () => {
  const next = resolveStickySelectedLines({
    existingFile: "apps/api/plane/db/models/state.py",
    existingLines: [56, 61],
    incomingFile: "apps/api/plane/db/models/state.py",
    incomingLines: [80, 90]
  });
  assert.deepEqual(next, [80, 90]);
});

test("sticky clears when the open file changes", () => {
  const next = resolveStickySelectedLines({
    existingFile: "apps/api/plane/db/models/state.py",
    existingLines: [56, 61],
    incomingFile: "apps/api/plane/api/middleware/api_authentication.py",
    incomingLines: undefined
  });
  assert.equal(next, undefined);
});

test("selectedLineRangesEqual compares tuples", () => {
  assert.equal(selectedLineRangesEqual([56, 61], [56, 61]), true);
  assert.equal(selectedLineRangesEqual([56, 61], [56, 62]), false);
  assert.equal(selectedLineRangesEqual(undefined, undefined), true);
});

const total = passed + failed;
console.log(`\nstickyEditorSelection: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
