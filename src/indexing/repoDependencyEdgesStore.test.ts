import assert from "node:assert/strict";
import {
  buildInsertBatch,
  dedupeDependencyEdgeRows,
  type RepoDependencyEdgeRow
} from "./repoDependencyEdgesStore";

function edge(
  fromPath: string,
  toPath: string,
  overrides: Partial<RepoDependencyEdgeRow> = {}
): RepoDependencyEdgeRow {
  return {
    fromPath,
    toPath,
    kind: "import",
    source: "import-parse",
    ...overrides
  };
}

void (async () => {
  assert.deepEqual(dedupeDependencyEdgeRows([]), []);

  const single = edge("src/a.ts", "src/b.ts");
  assert.deepEqual(dedupeDependencyEdgeRows([single]), [single]);

  const dupA = edge("src/a.ts", "src/b.ts", { line: 3, symbol: "foo" });
  const dupB = edge("src/a.ts", "src/b.ts", { line: 3, symbol: "bar" });
  assert.deepEqual(dedupeDependencyEdgeRows([dupA, dupB]), [dupA]);

  const noSymbol = edge("src/a.ts", "src/c.ts", { line: 1 });
  const withSymbol = edge("src/a.ts", "src/c.ts", { line: 1, symbol: "Widget" });
  assert.deepEqual(dedupeDependencyEdgeRows([noSymbol, withSymbol]), [withSymbol]);

  const indexedAt = new Date("2026-08-07T12:00:00.000Z");
  const batch = buildInsertBatch(
    "org-1",
    "owner/repo",
    [edge("src/a.ts", "src/b.ts", { line: 12, symbol: "Thing", source: "scip" })],
    indexedAt
  );
  assert.equal(batch.placeholders.length, 1);
  assert.match(batch.placeholders[0]!, /^\(\$\d+, \$\d+, \$\d+, \$\d+, \$\d+, \$\d+, \$\d+, \$\d+, \$\d+\)$/);
  assert.deepEqual(batch.values, [
    "org-1",
    "owner/repo",
    "src/a.ts",
    "src/b.ts",
    "import",
    "Thing",
    12,
    "scip",
    indexedAt
  ]);

  const defaultLineBatch = buildInsertBatch("org-1", "owner/repo", [edge("a.ts", "b.ts")], indexedAt);
  assert.equal(defaultLineBatch.values[6], 0);
  assert.equal(defaultLineBatch.values[5], null);

  console.log("repoDependencyEdgesStore: 1/1 tests passed");
})();
