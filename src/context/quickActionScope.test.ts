import assert from "node:assert/strict";
import {
  isFileLevelQuickAction,
  isQuickActionBlocked,
  quickActionBlockedMessage,
  quickActionWorksWithoutFile
} from "./quickActionScope";
import type { RepoContext } from "../chat/types";

async function run(): Promise<void> {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  const repoContext: RepoContext = {
    owner: "acme",
    repo: "widgets",
    branch: "main",
    scope: "repo"
  };

  test("repo-wide actions work without file when repo is selected", () => {
    assert.equal(quickActionWorksWithoutFile("find-owner"), true);
    assert.equal(isQuickActionBlocked("find-owner", repoContext), false);
    assert.equal(isQuickActionBlocked("knowledge-gaps", repoContext), false);
    assert.equal(isQuickActionBlocked("understand-repo", repoContext), false);
  });

  test("file-level actions are blocked at repo scope", () => {
    assert.equal(isFileLevelQuickAction("blast-radius"), true);
    assert.equal(isQuickActionBlocked("blast-radius", repoContext), true);
    assert.equal(isQuickActionBlocked("trace-decision", repoContext), true);
  });

  test("blast-radius slash at repo scope explains file-level requirement", () => {
    const message = quickActionBlockedMessage("blast-radius", repoContext);
    assert.match(message, /file level/i);
    assert.match(message, /Blast Radius/);
  });

  test("trace-decision slash at repo scope explains file-level requirement", () => {
    const message = quickActionBlockedMessage("trace-decision", repoContext);
    assert.match(message, /file level/i);
    assert.match(message, /Trace Decision/);
  });

  test("find-owner is blocked without repo coordinates", () => {
    assert.equal(isQuickActionBlocked("find-owner", {}), true);
  });

  const total = passed + failed;
  console.log(`\nquickActionScope: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
