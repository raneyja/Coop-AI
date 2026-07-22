import assert from "node:assert/strict";
import {
  displayFileLabel,
  displayRepoLabel,
  inferContextScope,
  isExplicitRepoScope,
  normalizeRepoContext,
  repoContextForFile,
  repoContextForRepoSelect
} from "./contextScope";

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

  await test("inferContextScope defaults to repo without file", () => {
    assert.equal(inferContextScope({ owner: "coop-ai", repo: "Coop-AI" }), "repo");
  });

  await test("inferContextScope infers file when file exists", () => {
    assert.equal(inferContextScope({ file: "src/chat/CoopChatSession.ts" }), "file");
  });

  await test("inferContextScope honors explicit repo scope", () => {
    assert.equal(inferContextScope({ scope: "repo", file: "src/chat/CoopChatSession.ts" }), "repo");
  });

  await test("normalizeRepoContext clears file fields for repo scope", () => {
    const normalized = normalizeRepoContext({
      owner: "coop-ai",
      repo: "Coop-AI",
      scope: "repo",
      file: "src/chat/CoopChatSession.ts",
      fileSource: "workspace",
      selectedLines: [12, 30],
      selectedSymbol: "handleMessage",
      languageId: "typescript",
      contextWarning: "Only files on disk can be linked to GitHub"
    });
    assert.equal(normalized.scope, "repo");
    assert.equal(normalized.file, undefined);
    assert.equal(normalized.fileSource, undefined);
    assert.equal(normalized.selectedLines, undefined);
    assert.equal(normalized.selectedSymbol, undefined);
    assert.equal(normalized.languageId, undefined);
    assert.equal(normalized.contextWarning, "Only files on disk can be linked to GitHub");
  });

  await test("normalizeRepoContext keeps external absolute file for composer chip", () => {
    const normalized = normalizeRepoContext({
      owner: "coop-ai",
      repo: "Coop-AI",
      file: "/Users/jonraney/Downloads/cursor_session.md",
      fileSource: "external",
      contextWarning: "This file is not in your opened workspace or a git repo."
    });
    assert.equal(normalized.scope, "file");
    assert.equal(normalized.file, "/Users/jonraney/Downloads/cursor_session.md");
    assert.equal(normalized.fileSource, "external");
  });

  await test("normalizeRepoContext keeps external fileSource at repo scope", () => {
    const normalized = normalizeRepoContext({
      owner: "coop-ai",
      repo: "Coop-AI",
      fileSource: "external",
      contextWarning: "This file is not in your opened workspace or a git repo."
    });
    assert.equal(normalized.scope, "repo");
    assert.equal(normalized.file, undefined);
    assert.equal(normalized.fileSource, "external");
  });

  await test("normalizeRepoContext preserves file details for file scope", () => {
    const normalized = normalizeRepoContext({
      owner: "coop-ai",
      repo: "Coop-AI",
      file: " src/context/contextScope.ts ",
      fileSource: "workspace",
      selectedLines: [10, 20]
    });
    assert.equal(normalized.scope, "file");
    assert.equal(normalized.file, "src/context/contextScope.ts");
    assert.equal(normalized.fileSource, "workspace");
    assert.deepEqual(normalized.selectedLines, [10, 20]);
  });

  await test("repoContextForRepoSelect returns repo-scoped context", () => {
    const ctx = repoContextForRepoSelect({
      provider: "github",
      owner: "coop-ai",
      repo: "Coop-AI",
      branch: "main"
    });
    assert.equal(ctx.scope, "repo");
    assert.equal(ctx.owner, "coop-ai");
    assert.equal(ctx.repo, "Coop-AI");
    assert.equal(ctx.branch, "main");
    assert.equal(ctx.file, undefined);
  });

  await test("repoContextForFile returns file-scoped context", () => {
    const ctx = repoContextForFile("src/context/contextScope.ts", "coop-ai", "Coop-AI", {
      provider: "github",
      branch: "main",
      fileSource: "workspace",
      selectedLines: [1, 10]
    });
    assert.equal(ctx.scope, "file");
    assert.equal(ctx.file, "src/context/contextScope.ts");
    assert.equal(ctx.owner, "coop-ai");
    assert.equal(ctx.repo, "Coop-AI");
    assert.equal(ctx.provider, "github");
    assert.equal(ctx.branch, "main");
    assert.equal(ctx.fileSource, "workspace");
    assert.deepEqual(ctx.selectedLines, [1, 10]);
  });

  await test("displayRepoLabel shows slash-prefixed repo name", () => {
    assert.equal(displayRepoLabel("coop-ai", "Coop-AI"), "/Coop-AI");
  });

  await test("isExplicitRepoScope is true only for explicit repo scope", () => {
    assert.equal(isExplicitRepoScope({ scope: "repo", owner: "coop-ai", repo: "Coop-AI" }), true);
    assert.equal(isExplicitRepoScope({ owner: "coop-ai", repo: "Coop-AI" }), false);
    assert.equal(isExplicitRepoScope({ scope: "file", file: "src/a.ts" }), false);
  });

  await test("displayFileLabel returns filename for nested path", () => {
    assert.equal(displayFileLabel("src/context/contextScope.ts"), "contextScope.ts");
  });

  await test("displayFileLabel handles windows-style separators", () => {
    assert.equal(displayFileLabel("src\\webview\\ChatPanel.tsx"), "ChatPanel.tsx");
  });

  const total = passed + failed;
  console.log(`\ncontextScope: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
