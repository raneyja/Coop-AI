import assert from "node:assert/strict";
import {
  activeEditorIdentityToRepoContext,
  isLocalEditorIdentity,
  isRemoteEditorIdentity,
  preserveEditorFilePath
} from "./activeEditorIdentity";
import { isOsAbsoluteDiskPath } from "./outsideWorkspaceFile";

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  await test("preserveEditorFilePath keeps Downloads absolute path for external", () => {
    const path = "/Users/jonraney/Downloads/cursor_session.md";
    assert.equal(preserveEditorFilePath(path, "external"), path);
    assert.equal(isOsAbsoluteDiskPath(path), true);
  });

  await test("preserveEditorFilePath keeps absolute path when fileSource omitted", () => {
    const path = "/Users/jonraney/Downloads/notes.md";
    assert.equal(preserveEditorFilePath(path), path);
  });

  await test("preserveEditorFilePath strips leading slash for repo-relative paths", () => {
    assert.equal(preserveEditorFilePath("/src/chat/CoopChatSession.ts", "workspace"), "src/chat/CoopChatSession.ts");
  });

  await test("activeEditorIdentityToRepoContext stamps file scope for external", () => {
    const ctx = activeEditorIdentityToRepoContext({
      file: "/Users/jonraney/Downloads/cursor_session.md",
      fileSource: "external",
      scope: "file",
      languageId: "markdown",
      owner: "acme",
      repo: "coop-ai"
    });
    assert.equal(ctx.scope, "file");
    assert.equal(ctx.file, "/Users/jonraney/Downloads/cursor_session.md");
    assert.equal(ctx.fileSource, "external");
    assert.equal(ctx.owner, "acme");
    assert.equal(ctx.repo, "coop-ai");
  });

  await test("isLocalEditorIdentity treats external as local for L badge", () => {
    assert.equal(isLocalEditorIdentity("external"), true);
    assert.equal(isLocalEditorIdentity("workspace"), true);
    assert.equal(isLocalEditorIdentity("git"), true);
    assert.equal(isRemoteEditorIdentity("remote"), true);
    assert.equal(isRemoteEditorIdentity("external"), false);
  });

  const total = passed + failed;
  console.log(`\nactiveEditorIdentity: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
