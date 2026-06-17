import assert from "node:assert/strict";
import {
  dedupeSymbolRows,
  mergeSymbolReferences,
  type SymbolIndexRow
} from "./repoSymbolIndexStore";

function row(
  symbol: string,
  filePath: string,
  lineStart: number,
  references: SymbolIndexRow["references"] = []
): SymbolIndexRow {
  return {
    symbol,
    filePath,
    lineStart,
    lineEnd: lineStart,
    kind: "function",
    references
  };
}

void (async () => {
  assert.deepEqual(dedupeSymbolRows([]), []);

  const single = row("foo", "src/a.ts", 10);
  assert.deepEqual(dedupeSymbolRows([single]), [single]);

  const dupA = row("MyClass#method", "src/a.ts", 42, [{ file_path: "src/b.ts", line: 3 }]);
  const dupB = row("MyClass#method", "src/a.ts", 42, [
    { file_path: "src/b.ts", line: 3 },
    { file_path: "src/c.ts", line: 7 }
  ]);
  const [merged] = dedupeSymbolRows([dupA, dupB]);
  assert.equal(merged.symbol, "MyClass#method");
  assert.equal(merged.filePath, "src/a.ts");
  assert.equal(merged.lineStart, 42);
  assert.deepEqual(merged.references, [
    { file_path: "src/b.ts", line: 3 },
    { file_path: "src/c.ts", line: 7 }
  ]);

  assert.deepEqual(mergeSymbolReferences([], []), []);
  assert.deepEqual(
    mergeSymbolReferences(
      [{ file_path: "a.ts", line: 1 }],
      [{ file_path: "a.ts", line: 1 }, { file_path: "b.ts", line: 2 }]
    ),
    [
      { file_path: "a.ts", line: 1 },
      { file_path: "b.ts", line: 2 }
    ]
  );

  console.log("repoSymbolIndexStore: 1/1 tests passed");
})();
