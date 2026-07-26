import assert from "node:assert/strict";
import { formatEditSelectionReminder } from "./editSelectionFocus";

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

test("formatEditSelectionReminder names the line range and file", () => {
  const text = formatEditSelectionReminder([17, 45], "src/CoopChatPanel.ts");
  assert.match(text, /edit_selection_focus/);
  assert.match(text, /lines 17-45/);
  assert.match(text, /CoopChatPanel\.ts/);
  assert.match(text, /ONLY edit target/);
});

test("formatEditSelectionReminder embeds highlighted code when provided", () => {
  const text = formatEditSelectionReminder(
    [35, 44],
    "src/CoopSettingsPanel.ts",
    "public static revive(...) {\n  return instance;\n}"
  );
  assert.match(text, /Highlighted code/);
  assert.match(text, /public static revive/);
  assert.match(text, /SEARCH must match this text/);
});

console.log(`\neditSelectionFocus: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
