import assert from "node:assert/strict";
import { mergeRepoContext } from "./repoContextMerge";

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

  await test("mergeRepoContext clears stale selectedLines when editor snap omits selection", () => {
    const merged = mergeRepoContext(
      { file: "src/old.ts", selectedLines: [10, 20] },
      { file: "src/new.ts", fileSource: "workspace", languageId: "typescript", selectedLines: undefined }
    );
    assert.equal(merged.file, "src/new.ts");
    assert.equal(merged.selectedLines, undefined);
  });

  await test("mergeRepoContext preserves selectedLines for partial incoming context", () => {
    const merged = mergeRepoContext(
      { file: "src/old.ts", selectedLines: [10, 20] },
      { owner: "acme" }
    );
    assert.equal(merged.selectedLines?.[0], 10);
    assert.equal(merged.file, "src/old.ts");
  });

  await test("mergeRepoContext clears disk-link warning when sidebar steals editor focus", () => {
    const diskWarning =
      "Only files on disk can be linked to GitHub. Open a local clone with File → Open Folder.";
    const merged = mergeRepoContext(
      { file: "src/chat/CoopChatSession.ts", fileSource: "workspace" },
      { fileSource: "external", contextWarning: diskWarning }
    );
    assert.equal(merged.file, "src/chat/CoopChatSession.ts");
    assert.equal(merged.fileSource, "workspace");
    assert.equal(merged.contextWarning, undefined);
  });

  await test("mergeRepoContext clears persisted disk-link warning for remote tabs on focus loss", () => {
    const diskWarning =
      "Only files on disk can be linked to GitHub. Open a local clone with File → Open Folder.";
    const merged = mergeRepoContext(
      { file: "src/api/githubAppApi.ts", fileSource: "remote", contextWarning: diskWarning },
      { fileSource: "external", contextWarning: diskWarning }
    );
    assert.equal(merged.file, "src/api/githubAppApi.ts");
    assert.equal(merged.fileSource, "remote");
    assert.equal(merged.contextWarning, undefined);
  });

  await test("mergeRepoContext promotes file when editor provides file under explicit repo scope", () => {
    const merged = mergeRepoContext(
      { owner: "acme", repo: "coop-ai", scope: "repo" },
      { file: "src/a.ts", fileSource: "workspace", scope: "file" }
    );
    assert.equal(merged.scope, "file");
    assert.equal(merged.file, "src/a.ts");
    assert.equal(merged.owner, "acme");
    assert.equal(merged.repo, "coop-ai");
  });

  await test("mergeRepoContext keeps absolute path for real outside-workspace editor", () => {
    const merged = mergeRepoContext(
      {
        file: "src/chat/CoopChatSession.ts",
        fileSource: "workspace",
        owner: "acme",
        repo: "coop-ai"
      },
      {
        file: "/Users/jonraney/Downloads/cursor_session.md",
        fileSource: "external",
        languageId: "markdown",
        contextWarning:
          "This file is not in your opened workspace or a git repo. Use File → Open Folder on the project clone."
      }
    );
    assert.equal(merged.file, "/Users/jonraney/Downloads/cursor_session.md");
    assert.equal(merged.fileSource, "external");
    assert.equal(merged.scope, "file");
    assert.equal(merged.owner, "acme");
    assert.equal(merged.repo, "coop-ai");
  });

  await test("mergeRepoContext clears file when repo scope is active", () => {
    const merged = mergeRepoContext(
      { owner: "acme", repo: "coop-ai", scope: "repo", file: undefined },
      { owner: "acme", repo: "coop-ai", fileSource: "external", contextWarning: "focus loss" }
    );
    assert.equal(merged.scope, "repo");
    assert.equal(merged.file, undefined);
    assert.equal(merged.owner, "acme");
    assert.equal(merged.repo, "coop-ai");
  });

  const total = passed + failed;
  console.log(`\nrepoContextMerge: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
