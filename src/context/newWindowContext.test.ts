import assert from "node:assert/strict";
import { isExplicitRepoScope, normalizeRepoContext, repoContextForRepoSelect } from "./contextScope";
import { mergeRepoContext } from "./repoContextMerge";

/**
 * Product rule: a new Coop window starts with blank chips. Selecting a repo
 * must replace any prior file chip — never leave Window A's file stuck on.
 */
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

  await test("blank window → Use-repo clears prior file chip from another session", () => {
    const leakedFromOtherWindow = normalizeRepoContext({
      owner: "acme",
      repo: "old-repo",
      file: "src/leaked.ts",
      fileSource: "workspace",
      scope: "file"
    });
    const next = mergeRepoContext(
      leakedFromOtherWindow,
      repoContextForRepoSelect({
        provider: "github",
        owner: "acme",
        repo: "new-repo",
        branch: "main"
      }) as ReturnType<typeof normalizeRepoContext>
    );
    assert.equal(isExplicitRepoScope(next), true);
    assert.equal(next.file, undefined);
    assert.equal(next.fileSource, undefined);
    assert.equal(next.owner, "acme");
    assert.equal(next.repo, "new-repo");
    assert.equal(next.branch, "main");
  });

  await test("blank window → Use-repo clears outside-workspace Downloads chip", () => {
    const downloads = normalizeRepoContext({
      owner: "acme",
      repo: "old-repo",
      file: "/Users/jon/Downloads/notes.md",
      fileSource: "external",
      scope: "file"
    });
    const next = mergeRepoContext(
      downloads,
      repoContextForRepoSelect({
        owner: "acme",
        repo: "plane",
        branch: "preview"
      }) as ReturnType<typeof normalizeRepoContext>
    );
    assert.equal(next.scope, "repo");
    assert.equal(next.file, undefined);
    assert.equal(next.repo, "plane");
  });

  await test("fresh context object has no chips", () => {
    const blank = normalizeRepoContext({});
    assert.equal(blank.file, undefined);
    assert.equal(blank.owner, undefined);
    assert.equal(blank.repo, undefined);
    assert.equal(isExplicitRepoScope(blank), false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
