import assert from "node:assert/strict";
import { lightHighlight, MAX_HIGHLIGHT_CHARS, splitTokensByLine } from "./lightHighlight";

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

function kindsFor(code: string, language?: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const token of lightHighlight(code, language)) {
    const text = token.text.trim();
    if (text) {
      map[text] = token.kind;
    }
  }
  return map;
}

test("typescript keywords, types, and functions are classified", () => {
  const kinds = kindsFor(
    `export function extractBearerToken(value: string): AuthContext | undefined {\n  return value;\n}`,
    "typescript"
  );
  assert.equal(kinds.export, "keyword");
  assert.equal(kinds.function, "keyword");
  assert.equal(kinds.extractBearerToken, "function");
  assert.equal(kinds.string, "type");
  assert.equal(kinds.AuthContext, "type");
  assert.equal(kinds.undefined, "keyword");
  assert.equal(kinds.return, "keyword");
});

test("strings and comments are classified", () => {
  const kinds = kindsFor(`const label = "hello"; // note\n`, "typescript");
  assert.equal(kinds.const, "keyword");
  assert.equal(kinds['"hello"'], "string");
  assert.equal(kinds["// note"], "comment");
});

test("property access after a dot is classified", () => {
  const kinds = kindsFor(`req.headers.authorization`, "typescript");
  assert.equal(kinds.headers, "property");
  assert.equal(kinds.authorization, "property");
});

test("bash fences color strings and hash comments, not monochrome", () => {
  const kinds = kindsFor("find . -type f -printf '%s %p\\n' # sizes\n", "bash");
  assert.equal(kinds["'%s %p\\n'"], "string");
  assert.equal(kinds["# sizes"], "comment");
});

test("splitTokensByLine keeps kind across wrapped lines", () => {
  const lines = splitTokensByLine([
    { text: "foo\nbar", kind: "keyword" },
    { text: "\nbaz", kind: "plain" }
  ]);
  assert.equal(lines.length, 3);
  assert.equal(lines[0]![0]?.text, "foo");
  assert.equal(lines[1]![0]?.text, "bar");
  assert.equal(lines[2]![0]?.text, "baz");
});

test("huge code blocks highlight without hanging the webview", () => {
  const started = Date.now();
  const code = `${"x = 1\n".repeat(80)}${"a" + "b".repeat(MAX_HIGHLIGHT_CHARS)}`;
  const tokens = lightHighlight(code, "python");
  assert.ok(Date.now() - started < 500, "highlighter hung on a huge block");
  assert.ok(tokens.length >= 1);
  assert.equal(tokens[tokens.length - 1]?.kind, "plain");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
