import assert from "node:assert/strict";
import { parseGithubVfsUri, isRemoteTabAbsolutePath, pathsReferToSameFile } from "./githubVfsUri";

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

  await test("parseGithubVfsUri parses vscode-vfs github URIs", () => {
    const parsed = parseGithubVfsUri("vscode-vfs://github/raneyja/Coop-AI/src/server/githubAppApi.ts");
    assert.equal(parsed?.owner, "raneyja");
    assert.equal(parsed?.repo, "Coop-AI");
    assert.equal(parsed?.file, "src/server/githubAppApi.ts");
  });

  await test("parseGithubVfsUri parses github scheme URIs", () => {
    const parsed = parseGithubVfsUri("github://github/raneyja/Coop-AI/src/server/githubAppApi.ts");
    assert.equal(parsed?.file, "src/server/githubAppApi.ts");
  });

  await test("pathsReferToSameFile matches basename to full path", () => {
    assert.equal(
      pathsReferToSameFile("githubAppApi.ts", "src/server/githubAppApi.ts"),
      true
    );
    assert.equal(
      pathsReferToSameFile("src/server/other.ts", "src/server/githubAppApi.ts"),
      false
    );
  });

  await test("isRemoteTabAbsolutePath detects remote tab refs", () => {
    assert.equal(isRemoteTabAbsolutePath("vscode-vfs://github/o/r/file.ts"), true);
    assert.equal(isRemoteTabAbsolutePath("/Users/me/project/file.ts"), false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void run();
