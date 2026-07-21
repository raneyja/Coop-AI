import assert from "node:assert/strict";
import { parseGithubRemoteFromGitConfig } from "./gitRemoteConfig";
import { applyRemoteFirstFileIdentity, promoteRepoContextFileIdentity } from "./remoteFirstFileIdentity";

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

  await test("parseGithubRemoteFromGitConfig parses hyphenated repo names", () => {
    const config = `[remote "origin"]
\turl = https://github.com/raneyja/Coop-AI.git
\tfetch = +refs/heads/*:refs/remotes/origin/*`;
    const parsed = parseGithubRemoteFromGitConfig(config);
    assert.equal(parsed?.owner, "raneyja");
    assert.equal(parsed?.repo, "Coop-AI");
  });

  await test("parseGithubRemoteFromGitConfig parses ssh remotes", () => {
    const config = `[remote "origin"]
\turl = git@github.com:coop-demo-lab/vitest.git`;
    const parsed = parseGithubRemoteFromGitConfig(config);
    assert.equal(parsed?.owner, "coop-demo-lab");
    assert.equal(parsed?.repo, "vitest");
  });

  await test("applyRemoteFirstFileIdentity promotes workspace/git when owner/repo known", () => {
    const promoted = applyRemoteFirstFileIdentity(
      { file: "src/CoopSettingsPanel.ts", fileSource: "workspace" },
      { owner: "raneyja", repo: "Coop-AI" }
    );
    assert.equal(promoted.fileSource, "remote");
    assert.equal(promoted.owner, "raneyja");
    assert.equal(promoted.repo, "Coop-AI");
    assert.equal(promoted.warning, undefined);
  });

  await test("applyRemoteFirstFileIdentity keeps workspace when codehost coords missing", () => {
    const kept = applyRemoteFirstFileIdentity({
      file: "src/CoopSettingsPanel.ts",
      fileSource: "workspace"
    });
    assert.equal(kept.fileSource, "workspace");
  });

  await test("applyRemoteFirstFileIdentity does not change true remote or external", () => {
    assert.equal(
      applyRemoteFirstFileIdentity(
        { file: "a.ts", fileSource: "remote", owner: "o", repo: "r" },
        { owner: "o", repo: "r" }
      ).fileSource,
      "remote"
    );
    assert.equal(
      applyRemoteFirstFileIdentity(
        {
          file: "/Users/jonraney/Downloads/notes.md",
          fileSource: "external",
          warning: "outside"
        },
        { owner: "o", repo: "r" }
      ).fileSource,
      "external"
    );
  });

  await test("promoteRepoContextFileIdentity does not promote external files", () => {
    const kept = promoteRepoContextFileIdentity(
      {
        file: "/Users/jonraney/Downloads/notes.md",
        fileSource: "external" as const,
        owner: "raneyja",
        repo: "Coop-AI"
      }
    );
    assert.equal(kept.fileSource, "external");
  });

  await test("classifyEditorFileIdentityDecoration badges external as L", async () => {
    const { classifyEditorFileIdentityDecoration } = await import("./remoteFirstFileIdentity");
    assert.equal(
      classifyEditorFileIdentityDecoration({
        file: "/Users/jonraney/Downloads/notes.md",
        fileSource: "external"
      })?.badge,
      "L"
    );
    assert.equal(
      classifyEditorFileIdentityDecoration({
        file: "src/a.ts",
        fileSource: "remote",
        owner: "o",
        repo: "r"
      })?.badge,
      "R"
    );
  });

  await test("promoteRepoContextFileIdentity upgrades restored workspace context", () => {
    const promoted = promoteRepoContextFileIdentity(
      {
        file: "src/CoopSettingsPanel.ts",
        fileSource: "workspace" as const,
        owner: "raneyja",
        repo: "Coop-AI"
      }
    );
    assert.equal(promoted.fileSource, "remote");
  });

  await test("promoteRepoContextFileIdentity uses preference owner/repo when context lacks them", () => {
    const promoted = promoteRepoContextFileIdentity(
      { file: "src/a.ts", fileSource: "workspace" as const },
      { owner: "acme", repo: "widgets" }
    );
    assert.equal(promoted.fileSource, "remote");
    assert.equal(promoted.owner, "acme");
    assert.equal(promoted.repo, "widgets");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void run();
