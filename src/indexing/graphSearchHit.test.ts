/**
 * Search-hit contract. The index sends real match positions and scores; the
 * extension used to overwrite both with the hit's position in the list, so the
 * agent read the top of every file and answered from it.
 */
import assert from "node:assert/strict";
import { UNKNOWN_HIT_LINE, mapGraphSearchResponse, remoteHitLine } from "./graphSearchHit";

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

test("uses the line the server sent", () => {
  assert.equal(remoteHitLine({ path: "server/auth.py", line: 412 }), 412);
});

test("accepts the legacy sha carrier from older servers", () => {
  assert.equal(remoteHitLine({ path: "server/auth.py", sha: "412" }), 412);
});

test("prefers an explicit line over the legacy carrier", () => {
  assert.equal(remoteHitLine({ path: "server/auth.py", line: 412, sha: "1" }), 412);
});

test("reports unknown rather than inventing a position", () => {
  assert.equal(remoteHitLine({ path: "server/auth.py" }), UNKNOWN_HIT_LINE);
  assert.equal(remoteHitLine({ path: "server/auth.py", sha: "deadbeef" }), UNKNOWN_HIT_LINE);
  assert.equal(remoteHitLine({ path: "server/auth.py", line: 0 }), UNKNOWN_HIT_LINE);
  assert.equal(remoteHitLine({ path: "server/auth.py", line: -3 }), UNKNOWN_HIT_LINE);
});

test("unknown is not a valid 1-based line", () => {
  assert.ok(UNKNOWN_HIT_LINE < 1);
});

test("never derives a position from a hit's place in the result list", () => {
  const result = mapGraphSearchResponse({
    data: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }]
  });
  assert.deepEqual(
    result.hits.map((hit) => hit.lineNumber),
    [UNKNOWN_HIT_LINE, UNKNOWN_HIT_LINE, UNKNOWN_HIT_LINE]
  );
});

test("keeps the index's own scores instead of flattening them", () => {
  const result = mapGraphSearchResponse({
    data: [
      { path: "a.ts", score: 0.2 },
      { path: "b.ts", score: 0.9 }
    ]
  });
  assert.deepEqual(
    result.hits.map((hit) => hit.score),
    [0.2, 0.9]
  );
});

test("carries real match positions and snippets through", () => {
  const result = mapGraphSearchResponse({
    data: [{ path: "server/auth.py", line: 412, content: "def require_auth():", score: 0.8 }],
    freshness: "zoekt"
  });
  assert.equal(result.hits[0]?.lineNumber, 412);
  assert.equal(result.hits[0]?.content, "def require_auth():");
  assert.equal(result.source, "zoekt");
});

test("keeps symbol names and declaration lines", () => {
  const result = mapGraphSearchResponse({
    symbols: [
      { symbol: "require_auth", kind: "function", file: "server/auth.py", line: 412 }
    ]
  });
  assert.equal(result.symbols[0]?.displayName, "require_auth");
  assert.equal(result.symbols[0]?.line, 412);
  assert.equal(result.symbols[0]?.kind, "function");
});

test("drops records with no path or file", () => {
  const result = mapGraphSearchResponse({ data: [{ path: "  " }], symbols: [{ symbol: "x" }] });
  assert.deepEqual(result.hits, []);
  assert.deepEqual(result.symbols, []);
});

console.log(`\ngraphSearchHit: ${passed}/${passed + failed} tests passed`);
if (failed > 0) {
  process.exit(1);
}
