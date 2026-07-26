import assert from "node:assert/strict";
import { countHunks, parsePatchResponse, parsePatchVariants } from "./patchParser";

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

test("parsePatchVariants returns single unlabeled variant for a plain patch", () => {
  const result = parsePatchVariants(SAMPLE_PATCH);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0]!.id, "v0");
  assert.equal(result.variants[0]!.label, "");
  assert.equal(result.variants[0]!.patches.files[0]!.relativePath, "src/foo.ts");
});

test("parsePatchVariants splits labeled Option headers into separate variants", () => {
  const content = [
    "Here are two ways to do it.",
    "",
    "Option 1: Extract a helper",
    "",
    "File: `src/foo.ts`",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "const x = 1;",
    "=======",
    "const x = helper();",
    ">>>>>>> REPLACE",
    "```",
    "",
    "Option 2: Inline the value",
    "",
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
  const result = parsePatchVariants(content);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0]!.id, "v0");
  assert.equal(result.variants[0]!.index, 0);
  assert.equal(result.variants[0]!.label, "Option 1: Extract a helper");
  assert.equal(result.variants[0]!.patches.files[0]!.hunks[0]!.replace, "const x = helper();");
  assert.equal(result.variants[1]!.id, "v1");
  assert.equal(result.variants[1]!.label, "Option 2: Inline the value");
  assert.equal(result.variants[1]!.patches.files[0]!.hunks[0]!.replace, "const x = 2;");
});

test("parsePatchVariants supports markdown/bold Alternative headers and letters", () => {
  const content = [
    "## Option A — use a map",
    "",
    "File: `src/foo.ts`",
    "```patch",
    "<<<<<<< SEARCH",
    "a",
    "=======",
    "A",
    ">>>>>>> REPLACE",
    "```",
    "",
    "**Alternative B:** use reduce",
    "",
    "File: `src/foo.ts`",
    "```patch",
    "<<<<<<< SEARCH",
    "a",
    "=======",
    "B",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const result = parsePatchVariants(content);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0]!.label, "Option A: use a map");
  assert.equal(result.variants[1]!.label, "Option B: use reduce");
});

test("parsePatchVariants ignores option-like prose without patch blocks", () => {
  const content = [
    "Option 1: this is just discussion",
    "Option 2: more discussion, no patches here",
    "",
    "File: `src/foo.ts`",
    "```patch",
    "<<<<<<< SEARCH",
    "const x = 1;",
    "=======",
    "const x = 2;",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const result = parsePatchVariants(content);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  // Only one real patch set exists → collapse to a single variant.
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0]!.label, "");
});

test("parsePatchVariants propagates parse failure", () => {
  const result = parsePatchVariants("just some prose, no patches");
  assert.equal(result.ok, false);
});

test("parsePatchVariants recovers when options/TL;DR are listed after a patch dump", () => {
  // Reproduces the failure mode from the sidebar screenshots: model emits all
  // SEARCH/REPLACE hunks first, then Option — / TL;DR prose afterward.
  const content = [
    "File: `src/CoopSidebarProvider.ts`",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "export class CoopSidebarProvider {",
    "=======",
    "export class CoopSidebarProvider { // option1",
    ">>>>>>> REPLACE",
    "```",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "export class CoopSidebarProvider {",
    "=======",
    "export class CoopSidebarProvider { // option2",
    ">>>>>>> REPLACE",
    "```",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "export class CoopSidebarProvider {",
    "=======",
    "export class CoopSidebarProvider { // option3",
    ">>>>>>> REPLACE",
    "```",
    "",
    "Option 1 — Guard against multiple resolveWebviewView initializations",
    "TL;DR (Option 1): Add an initialized flag so session.initialize() only runs once.",
    "",
    "Option 2 — Clear this.view on dispose",
    "TL;DR (Option 2): Drop the stale view reference when the webview is disposed.",
    "",
    "Option 3 — Make refreshEditorContext resilient",
    "TL;DR (Option 3): Skip refresh when the view is missing or hidden."
  ].join("\n");
  const result = parsePatchVariants(content);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.variants.length, 3);
  assert.equal(result.variants[0]!.label, "Option 1: Guard against multiple resolveWebviewView initializations");
  assert.equal(
    result.variants[0]!.summary,
    "Add an initialized flag so session.initialize() only runs once."
  );
  assert.equal(result.variants[0]!.patches.files[0]!.hunks[0]!.replace, "export class CoopSidebarProvider { // option1");
  assert.equal(result.variants[1]!.patches.files[0]!.hunks[0]!.replace, "export class CoopSidebarProvider { // option2");
  assert.equal(result.variants[2]!.patches.files[0]!.hunks[0]!.replace, "export class CoopSidebarProvider { // option3");
  assert.match(result.variants[1]!.summary ?? "", /stale view/);
  assert.match(result.variants[2]!.summary ?? "", /Skip refresh/);
});

test("parsePatchVariants attaches TL;DR under each option in the happy path", () => {
  const content = [
    "Option 1: Extract a helper",
    "",
    "File: `src/foo.ts`",
    "```patch",
    "<<<<<<< SEARCH",
    "const x = 1;",
    "=======",
    "const x = helper();",
    ">>>>>>> REPLACE",
    "```",
    "TL;DR: Keeps the call site short and reuses the helper elsewhere.",
    "",
    "Option 2: Inline the value",
    "",
    "File: `src/foo.ts`",
    "```patch",
    "<<<<<<< SEARCH",
    "const x = 1;",
    "=======",
    "const x = 2;",
    ">>>>>>> REPLACE",
    "```",
    "TL;DR: Smallest possible change when the helper isn't needed."
  ].join("\n");
  const result = parsePatchVariants(content);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.variants.length, 2);
  assert.equal(result.variants[0]!.summary, "Keeps the call site short and reuses the helper elsewhere.");
  assert.equal(result.variants[1]!.summary, "Smallest possible change when the helper isn't needed.");
});

test("parsePatchVariants rejects options packed as comments in one REPLACE", () => {
  const content = [
    "File: `src/CoopSidebarProvider.ts`",
    "",
    "```patch",
    "<<<<<<< SEARCH",
    "export class CoopSidebarProvider {",
    "  public constructor(",
    "=======",
    "export class CoopSidebarProvider {",
    "  // Option 1: Keep minimal sidebar behavior",
    "  // tl;dr — Small helpers",
    "  public static createWithDefaultServices(): CoopSidebarProvider { return null as any; }",
    "  // Option 2: Expose a factory",
    "  // tl;dr — Custom thread scope",
    "  public static createWithThreadScope(): CoopSidebarProvider { return null as any; }",
    "  // Option 3: Add telemetry",
    "  // tl;dr — Log init",
    "  private logInitializationResult(): void {}",
    "  public constructor(",
    ">>>>>>> REPLACE",
    "```"
  ].join("\n");
  const result = parsePatchVariants(content);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.match(result.error, /comments|separate Apply cards|Option block/i);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
