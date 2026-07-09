import assert from "node:assert/strict";
import { countHunks, parsePatchResponse } from "./patchParser";

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

const SAMPLE_PATCH = [
  "File: `src/foo.ts`",
  "",
  "```patch",
  "<<<<<<< SEARCH",
  "const x = 1;",
  "=======",
  "const x = 2;",
  ">>>>>>> REPLACE",
  "```"
].join("\n");

test("parses single-file patch with backticks", () => {
  const result = parsePatchResponse(SAMPLE_PATCH);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.patches.files.length, 1);
  assert.equal(result.patches.files[0]!.relativePath, "src/foo.ts");
  assert.equal(result.patches.files[0]!.hunks.length, 1);
  assert.equal(result.patches.files[0]!.hunks[0]!.search, "const x = 1;");
  assert.equal(result.patches.files[0]!.hunks[0]!.replace, "const x = 2;");
});

test("parses File header without backticks", () => {
  const content = SAMPLE_PATCH.replace("File: `src/foo.ts`", "File: src/foo.ts");
  const result = parsePatchResponse(content);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.patches.files[0]!.relativePath, "src/foo.ts");
});

test("parses multiple hunks in one file", () => {
  const content = [
    "File: `src/foo.ts`",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "alpha",
    "=======",
    "beta",
    ">>>>>>> REPLACE",
    "```",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "gamma",
    "=======",
    "delta",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const result = parsePatchResponse(content);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.patches.files[0]!.hunks.length, 2);
  assert.equal(countHunks(result.patches), 2);
});

test("parses multiple files", () => {
  const content = [
    "One-line lead.",
    "",
    "File: `src/a.ts`",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "a",
    "=======",
    "A",
    ">>>>>>> REPLACE",
    "```",
    "",
    "File: `src/b.ts`",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "b",
    "=======",
    "B",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const result = parsePatchResponse(content);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.patches.files.length, 2);
  assert.equal(result.patches.files[0]!.relativePath, "src/a.ts");
  assert.equal(result.patches.files[1]!.relativePath, "src/b.ts");
});

test("fails when hunks exist without File header", () => {
  const content = [
    "```patch",
    "<<<<<<< SEARCH",
    "a",
    "=======",
    "b",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const result = parsePatchResponse(content);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.match(result.error, /File: header/);
});

test("fails when File header has no hunks", () => {
  const result = parsePatchResponse("File: `src/foo.ts`\n\nNo patch here.");
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.match(result.error, /No patch hunks/);
});

test("preserves leading and trailing whitespace inside hunks", () => {
  const content = [
    "File: `src/foo.ts`",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "  const x = 1;  ",
    "=======",
    "  const x = 2;  ",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const result = parsePatchResponse(content);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.patches.files[0]!.hunks[0]!.search, "  const x = 1;  ");
  assert.equal(result.patches.files[0]!.hunks[0]!.replace, "  const x = 2;  ");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
