import assert from "node:assert/strict";
import {
  languageFromFilePath,
  languageTagMatchesPath,
  resolveCitePathForLanguageFence,
  tryParseCitationLocator
} from "./codeCitationLocator";
import { lightHighlight } from "./lightHighlight";

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

test("javascript tag matches typescript path (family)", () => {
  assert.equal(
    languageTagMatchesPath("javascript", "packages/lib/jobs/send-signing-email.ts"),
    true
  );
});

test("resolveCitePath upgrades javascript fence for open .ts file", () => {
  const path = resolveCitePathForLanguageFence({
    language: "javascript",
    code: "export const X = 1;",
    lines: ["Here's a relevant code snippet:", "```javascript"],
    fenceStartIndex: 1,
    activeFilePath: "packages/lib/jobs/send-signing-email.ts"
  });
  assert.equal(path, "packages/lib/jobs/send-signing-email.ts");
});

test("lightHighlight colors javascript keywords", () => {
  const tokens = lightHighlight("export const x = 'hi';", "javascript");
  assert.ok(tokens.some((t) => t.text === "export" && t.kind === "keyword"));
  assert.ok(tokens.some((t) => t.text === "'hi'" && t.kind === "string"));
});

test("lightHighlight colors go-like unknown langs instead of monochrome", () => {
  const tokens = lightHighlight("func main() {\n  return\n}", "go");
  assert.ok(tokens.some((t) => t.kind === "keyword"));
});

console.log(`\ncodeCitationLocator: ${passed}/${passed + failed} tests ${failed === 0 ? "passed" : "FAILED"}`);
if (failed > 0) {
  process.exit(1);
}
