import assert from "node:assert/strict";
import { toRepositoryRelativePath } from "./repoFilePath";

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

  await test("toRepositoryRelativePath keeps Downloads absolute path unchanged", () => {
    const path = "/Users/jonraney/Downloads/cursor_session.md";
    assert.equal(toRepositoryRelativePath(path), path);
  });

  await test("toRepositoryRelativePath restores stripped Users/ absolute paths", () => {
    assert.equal(
      toRepositoryRelativePath("Users/jonraney/Downloads/notes.md"),
      "/Users/jonraney/Downloads/notes.md"
    );
  });

  await test("toRepositoryRelativePath leaves repo-relative paths relative", () => {
    assert.equal(toRepositoryRelativePath("src/chat/CoopChatSession.ts"), "src/chat/CoopChatSession.ts");
    assert.equal(toRepositoryRelativePath("/src/chat/CoopChatSession.ts"), "src/chat/CoopChatSession.ts");
  });

  const total = passed + failed;
  console.log(`\nrepoFilePath: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
