import "../autocomplete/test/vscodeMockSetup";
import assert from "node:assert/strict";
import { buildPatchCardState } from "./patchDiffPreview";
import type { ParsedPatchSet } from "./patchParser";

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

const samplePatch: ParsedPatchSet = {
  files: [
    {
      relativePath: "src/example.ts",
      hunks: [
        {
          search: "private bindSession(session: CoopChatSession): void {",
          replace: "/** Re-attaches session. */\nprivate bindSession(session: CoopChatSession): void {"
        }
      ]
    }
  ]
};

test("buildPatchCardState returns pending metadata", () => {
  const state = buildPatchCardState(samplePatch, {
    status: "pending",
    messageTimestamp: 123,
    fileContents: {
      "src/example.ts": "private bindSession(session: CoopChatSession): void {\n}\n"
    }
  });
  assert.equal(state.status, "pending");
  assert.equal(state.fileCount, 1);
  assert.equal(state.hunkCount, 1);
  assert.equal(state.messageTimestamp, 123);
  assert.equal(state.files[0]?.relativePath, "src/example.ts");
});

test("buildPatchCardState includes add/remove diff lines", () => {
  const state = buildPatchCardState(samplePatch, {
    status: "pending",
    fileContents: {
      "src/example.ts": "private bindSession(session: CoopChatSession): void {\n  // body\n}\n"
    }
  });
  const hunk = state.files[0]?.hunks[0];
  assert.ok(hunk);
  assert.equal(hunk.matchStatus, "matched");
  assert.ok(hunk.lines.some((line) => line.kind === "remove"));
  assert.ok(hunk.lines.some((line) => line.kind === "add"));
});

console.log(`\npatchDiffPreview: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
