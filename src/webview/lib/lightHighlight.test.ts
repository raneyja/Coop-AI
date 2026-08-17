import assert from "node:assert/strict";
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
