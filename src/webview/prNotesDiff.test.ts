import assert from "node:assert/strict";
import { compactPatchDiffForPrNotes } from "./prNotesDiff";
import type { PatchPreviewFile } from "../chat/types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

test("compactPatchDiffForPrNotes keeps add/remove lines and skips rejected hunks", () => {
  const files: PatchPreviewFile[] = [
    {
      relativePath: "src/server/authMiddleware.ts",
      hunks: [
        {
          id: "h1",
          matchStatus: "matched",
          status: "applied",
          lines: [
            { kind: "context", text: "export function isPlanAllowed() {" },
            { kind: "add", text: "// Check if the plan is allowed" },
            { kind: "remove", text: "  return true;" },
            { kind: "add", text: "  return allowedPlans.includes(plan);" }
          ]
        },
        {
          id: "h2",
          matchStatus: "matched",
          status: "rejected",
          lines: [{ kind: "add", text: "should not appear" }]
        }
      ]
    }
  ];
  const diff = compactPatchDiffForPrNotes(files);
  assert.match(diff, /authMiddleware\.ts/);
  assert.match(diff, /\+ \/\/ Check if the plan is allowed/);
  assert.doesNotMatch(diff, /should not appear/);
  assert.doesNotMatch(diff, /export function isPlanAllowed/);
});

console.log(`\nprNotesDiff: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
