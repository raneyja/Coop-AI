import assert from "node:assert/strict";
import { languageFromFilePath, tryParseCitationLocator } from "./codeCitationLocator";

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

test("numeric locator parses path and lines", () => {
  const locator = tryParseCitationLocator(
    "42:68:apps/api/plane/api/middleware/api_authentication.py"
  );
  assert.ok(locator);
  assert.equal(locator?.startLine, 42);
  assert.equal(locator?.endLine, 68);
  assert.equal(locator?.path, "apps/api/plane/api/middleware/api_authentication.py");
});

test("placeholder locator recovers path without lines", () => {
  const locator = tryParseCitationLocator(
    "startLine:endLine:apps/api/plane/api/middleware/api_authentication.py"
  );
  assert.ok(locator);
  assert.equal(locator?.path, "apps/api/plane/api/middleware/api_authentication.py");
  assert.equal(locator?.startLine, undefined);
  assert.equal(locator?.endLine, undefined);
});

test("language tags are not citations", () => {
  assert.equal(tryParseCitationLocator("typescript"), null);
  assert.equal(tryParseCitationLocator("python"), null);
  assert.equal(tryParseCitationLocator("TEXT"), null);
});

test("path-only locator works", () => {
  const locator = tryParseCitationLocator("src/webview/ChatPanel.tsx");
  assert.ok(locator);
  assert.equal(locator?.path, "src/webview/ChatPanel.tsx");
});

test("languageFromFilePath maps py to python", () => {
  assert.equal(languageFromFilePath("apps/api/foo.py"), "python");
  assert.equal(languageFromFilePath("src/a.tsx"), "typescript");
});

console.log(`\ncodeCitationLocator: ${passed}/${passed + failed} tests ${failed === 0 ? "passed" : "FAILED"}`);
if (failed > 0) {
  process.exit(1);
}
