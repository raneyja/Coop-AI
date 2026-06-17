import assert from "node:assert/strict";
import { parseGithubRemoteFromGitConfig } from "./gitRemoteConfig";

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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void run();
