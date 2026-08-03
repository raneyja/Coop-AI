import assert from "node:assert/strict";
import type { CommitInfo } from "../api/codeHosts/types";
import {
  pickRecentEvolutionCommits,
  selectFocusCommit
} from "./decisionFocusCommit";
import type { DecisionCommit } from "../types/decisionTimeline";

function commit(partial: Partial<DecisionCommit> & Pick<DecisionCommit, "sha" | "message">): DecisionCommit {
  return {
    author: partial.author ?? "@dev",
    date: partial.date ?? "2026-07-01T00:00:00Z",
    ...partial
  };
}

function historyEntry(
  partial: Partial<CommitInfo> & Pick<CommitInfo, "sha" | "message">
): CommitInfo {
  return {
    author: partial.author ?? "Dev",
    date: partial.date ?? "2026-07-01T00:00:00Z",
    ...partial
  };
}

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

  await test("selectFocusCommit keeps introduction for line selections", () => {
    const introduction = commit({
      sha: "aaaaaaa1",
      message: "Initial commit: Coop AI VS Code extension and tooling scaffold."
    });
    const focus = selectFocusCommit({
      lineRange: { start: 10, end: 20 },
      introduction,
      recentCommits: [
        commit({
          sha: "bbbbbbb2",
          message: "Keep remote file chips as R and stop New Chat inheriting leftovers."
        })
      ]
    });
    assert.equal(focus.sha, introduction.sha);
  });

  await test("selectFocusCommit prefers high-signal recent commit for full-file traces", () => {
    const introduction = commit({
      sha: "aaaaaaa1",
      message: "Initial commit: Coop AI VS Code extension and tooling."
    });
    const recentWeak = commit({ sha: "ccccccc3", message: "fix stuff" });
    const recentStrong = commit({
      sha: "bbbbbbb2",
      message: "Keep remote file chips as R and stop New Chat inheriting leftovers."
    });
    const focus = selectFocusCommit({
      introduction,
      recentCommits: [recentWeak, recentStrong]
    });
    assert.equal(focus.sha, recentStrong.sha);
  });

  await test("selectFocusCommit prefers ask-aligned commit over unrelated high-signal recent", () => {
    const introduction = commit({
      sha: "aaaaaaa1",
      message: "Initial commit: Coop AI VS Code extension and tooling."
    });
    const unrelated = commit({
      sha: "mig00001",
      message: "Add ProjectIssueType migration and deploy board helpers for issues."
    });
    const aligned = commit({
      sha: "state001",
      message: "Refine StateGroup choices used by the state model workflow."
    });
    const focus = selectFocusCommit({
      introduction,
      recentCommits: [unrelated, aligned],
      focusTerms: ["stategroup", "state"]
    });
    assert.equal(focus.sha, aligned.sha);
  });

  await test("selectFocusCommit falls back to newest recent when none are high-signal", () => {
    const introduction = commit({
      sha: "aaaaaaa1",
      message: "Initial commit: Coop AI VS Code extension and tooling."
    });
    const newest = commit({ sha: "ddddddd4", message: "update" });
    const focus = selectFocusCommit({
      introduction,
      recentCommits: [newest, commit({ sha: "eeeeeee5", message: "wip" })]
    });
    assert.equal(focus.sha, newest.sha);
  });

  await test("pickRecentEvolutionCommits skips introduction and caps at limit", () => {
    const history = [
      historyEntry({
        sha: "r1",
        message: "Keep remote file chips as R and stop New Chat inheriting leftovers."
      }),
      historyEntry({
        sha: "r2",
        message: "Fix chat file chips: L/R identity, open-on-pick, and thread vs reload."
      }),
      historyEntry({
        sha: "r3",
        message: "Expand chat UX, repo context, and update marketing site screenshot."
      }),
      historyEntry({
        sha: "intro",
        message: "Initial commit: Coop AI VS Code extension and tooling."
      }),
      historyEntry({ sha: "older", message: "Should not appear" })
    ];
    const picked = pickRecentEvolutionCommits(history, "intro", 3);
    assert.deepEqual(
      picked.map((entry) => entry.sha),
      ["r1", "r2", "r3"]
    );
  });

  const total = passed + failed;
  console.log(`\ndecisionFocusCommit: ${passed}/${total} tests passed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void run();
