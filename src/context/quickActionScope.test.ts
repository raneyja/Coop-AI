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

  test("Understand Repo is blocked when a file chip is active", () => {
    const withFile: RepoContext = {
      owner: "acme",
      repo: "widgets",
      branch: "main",
      file: "src/CoopSettingsPanel.ts",
      scope: "file"
    };
    assert.equal(isQuickActionBlocked("understand-repo", withFile), true);
    assert.match(
      quickActionBlockedMessage("understand-repo", withFile),
      /repo-wide only/i
    );
    assert.match(quickActionBlockedMessage("understand-repo", withFile), /Use repo/i);
    // Other actions still allow a file chip.
    assert.equal(isQuickActionBlocked("find-owner", withFile), false);
    assert.equal(isQuickActionBlocked("knowledge-gaps", withFile), false);
  });

  test("prefs-seeded owner/repo without Use repo does not unlock Understand Repo", () => {
    const prefsOnly: RepoContext = {
      owner: "raneyja",
      repo: "Coop-AI",
      branch: "main"
      // no scope: "repo" — Settings default, not an explicit selection
    };
    assert.equal(isQuickActionBlocked("understand-repo", prefsOnly), true);
    assert.equal(isQuickActionBlocked("knowledge-gaps", prefsOnly), true);
    assert.equal(isQuickActionBlocked("find-owner", prefsOnly), true);
    assert.match(quickActionBlockedMessage("understand-repo", prefsOnly), /Use repo/i);
    assert.equal(
      /open a file/i.test(quickActionBlockedMessage("understand-repo", prefsOnly)),
      false
    );
  });

  test("empty context blocks repo-wide actions", () => {
    assert.equal(isQuickActionBlocked("understand-repo", {}), true);
    assert.equal(isQuickActionBlocked("knowledge-gaps", {}), true);
    assert.equal(isQuickActionBlocked("find-owner", {}), true);
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

  test("find-owner with prefs-only coordinates still needs Use repo", () => {
    assert.equal(
      isQuickActionBlocked("find-owner", { owner: "acme", repo: "widgets" }),
      true
    );
  });

  test("all quick actions block outside-workspace active file", () => {
    const external: RepoContext = {
      owner: "acme",
      repo: "widgets",
      branch: "main",
      fileSource: "external",
      contextWarning: "This file is not in your opened workspace or a git repo."
    };
    assert.equal(isQuickActionBlocked("trace-decision", external), true);
    assert.equal(isQuickActionBlocked("blast-radius", external), true);
    assert.equal(isQuickActionBlocked("knowledge-gaps", external), true);
    assert.equal(isQuickActionBlocked("understand-repo", external), true);
    assert.equal(isQuickActionBlocked("find-owner", external), true);
    assert.match(quickActionBlockedMessage("understand-repo", external), /outside the workspace/i);
    assert.match(quickActionBlockedMessage("find-owner", external), /outside the workspace/i);
  });

  test("absolute Downloads path is treated as outside-workspace even without fileSource", () => {
    const absolute: RepoContext = {
      owner: "acme",
      repo: "widgets",
      file: "/Users/jonraney/Downloads/cursor_session.md"
    };
    assert.equal(isQuickActionBlocked("knowledge-gaps", absolute), true);
    assert.equal(isQuickActionBlocked("trace-decision", absolute), true);
    assert.equal(isQuickActionBlocked("understand-repo", absolute), true);
    assert.equal(isQuickActionBlocked("find-owner", absolute), true);
  });

  test("chat-attached outside-workspace file still blocks every quick action", () => {
    // After plain-chat attach we keep absolute path + fileSource external.
    const attached: RepoContext = {
      owner: "acme",
      repo: "widgets",
      branch: "main",
      file: "/Users/jonraney/Downloads/cursor_session.md",
      fileSource: "external",
      scope: "file"
    };
    for (const action of [
      "understand-repo",
      "trace-decision",
      "find-owner",
      "blast-radius",
      "knowledge-gaps"
    ] as const) {
      assert.equal(isQuickActionBlocked(action, attached), true);
    }
  });

  const total = passed + failed;
  console.log(`\nquickActionScope: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
