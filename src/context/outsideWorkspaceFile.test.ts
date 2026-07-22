import assert from "node:assert/strict";
import { isExternalFileContext, isOsAbsoluteDiskPath, looksLikeAbsoluteDiskPath } from "./outsideWorkspaceFile";

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

test("looksLikeAbsoluteDiskPath detects macOS Downloads paths", () => {
  assert.equal(looksLikeAbsoluteDiskPath("/Users/jonraney/Downloads/cursor_session.md"), true);
  assert.equal(looksLikeAbsoluteDiskPath("Users/jonraney/Downloads/cursor_session.md"), true);
  assert.equal(looksLikeAbsoluteDiskPath("src/chat/CoopChatSession.ts"), false);
  assert.equal(looksLikeAbsoluteDiskPath("docs/handoff.md"), false);
});

test("isOsAbsoluteDiskPath ignores leading-slash repo paths", () => {
  assert.equal(isOsAbsoluteDiskPath("/Users/jonraney/Downloads/notes.md"), true);
  assert.equal(isOsAbsoluteDiskPath("/src/chat/CoopChatSession.ts"), false);
  assert.equal(isOsAbsoluteDiskPath("src/chat/CoopChatSession.ts"), false);
});

test("isExternalFileContext uses fileSource or absolute path", () => {
  assert.equal(isExternalFileContext({ fileSource: "external" }), true);
  assert.equal(
    isExternalFileContext({ file: "/Users/jonraney/Downloads/x.md", fileSource: "workspace" }),
    true
  );
  assert.equal(isExternalFileContext({ file: "src/a.ts", fileSource: "workspace" }), false);
});

const total = passed + failed;
console.log(`\noutsideWorkspaceFile: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
