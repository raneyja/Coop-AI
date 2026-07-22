import assert from "node:assert/strict";
import {
  clampExplorerListHeight,
  normalizeExplorerPath,
  parentExplorerPath
} from "./explorerPaths";

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

test("normalizeExplorerPath strips leading and trailing slashes", () => {
  assert.equal(normalizeExplorerPath("/src/webview/"), "src/webview");
  assert.equal(normalizeExplorerPath("src"), "src");
  assert.equal(normalizeExplorerPath(""), "");
});

test("parentExplorerPath returns parent or root", () => {
  assert.equal(parentExplorerPath("src/webview/components"), "src/webview");
  assert.equal(parentExplorerPath("src"), "");
  assert.equal(parentExplorerPath(""), "");
  assert.equal(parentExplorerPath("/src/foo/"), "src");
});

test("clampExplorerListHeight respects min and max", () => {
  assert.equal(clampExplorerListHeight(50, 96, 400), 96);
  assert.equal(clampExplorerListHeight(500, 96, 400), 400);
  assert.equal(clampExplorerListHeight(200.6, 96, 400), 201);
  assert.equal(clampExplorerListHeight(Number.NaN, 96, 400), 96);
});

console.log(`\nexplorerPaths: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  process.exit(1);
}
