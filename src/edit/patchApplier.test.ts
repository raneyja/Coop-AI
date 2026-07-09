import assert from "node:assert/strict";
import { applyHunkToContent, applyHunksToContent } from "./patchContent";

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

test("applies a single hunk", () => {
  const result = applyHunkToContent("const x = 1;\n", {
    search: "const x = 1;",
    replace: "const x = 2;"
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.content, "const x = 2;\n");
});

test("applies multiple hunks sequentially", () => {
  const source = "alpha\nbeta\ngamma\n";
  const result = applyHunksToContent(source, [
    { search: "alpha", replace: "ALPHA" },
    { search: "gamma", replace: "GAMMA" }
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.content, "ALPHA\nbeta\nGAMMA\n");
});

test("fails when search text is missing", () => {
  const result = applyHunkToContent("const x = 1;\n", {
    search: "missing",
    replace: "nope"
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.reason, "not_found");
});

test("fails when search text is ambiguous", () => {
  const result = applyHunkToContent("foo\nfoo\n", {
    search: "foo",
    replace: "bar"
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.reason, "ambiguous");
});

test("preserves whitespace in search blocks", () => {
  const source = "  indented();\n";
  const result = applyHunkToContent(source, {
    search: "  indented();",
    replace: "  fixed();"
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.content, "  fixed();\n");
});

test("fuzzy match tolerates trimmed line differences", () => {
  const source = "  const x = 1;\n  const y = 2;\n";
  const result = applyHunkToContent(source, {
    search: "const x = 1;\nconst y = 2;",
    replace: "const x = 9;\nconst y = 8;"
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.content, "  const x = 9;\n  const y = 8;\n");
});

test("fuzzy match normalizes indentation in replace block", () => {
  const source = "    function run() {\n      return 1;\n    }\n";
  const result = applyHunkToContent(source, {
    search: "function run() {\n  return 1;\n}",
    replace: "function run() {\n  return 2;\n}"
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.content, "    function run() {\n      return 2;\n    }\n");
});

test("fuzzy match trims trailing whitespace on lines", () => {
  const source = "alpha   \nbeta\n";
  const result = applyHunkToContent(source, {
    search: "alpha\nbeta",
    replace: "ALPHA\nBETA"
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.content, "ALPHA\nBETA\n");
});

test("fuzzy match fails when trimmed lines are ambiguous", () => {
  const source = "foo\nbar\nfoo\n";
  const result = applyHunkToContent(source, {
    search: "foo",
    replace: "baz"
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.reason, "ambiguous");
});

test("fuzzy match fails when no trimmed line block matches", () => {
  const source = "  alpha\n  beta\n";
  const result = applyHunkToContent(source, {
    search: "alpha\nmissing",
    replace: "nope"
  });
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.reason, "not_found");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
