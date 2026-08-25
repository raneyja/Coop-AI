import assert from "node:assert/strict";
import type { CommitInfo } from "../api/codeHosts/types";
import {
  pickRecentEvolutionCommits,
  selectFocusCommit,
  selectFocusCommitWithMeta
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

  await test("selectFocusCommit keeps introduction for line selections with no symbol ask", () => {
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

  await test("line selection with StateGroup ask does not keep a session-auth mega as aligned", () => {
    const introduction = commit({
      sha: "5933561",
      message: [
        "feat: session auth implementation (#4411)",
        "",
        "* chore: instance empty state for god-mode.",
        "x".repeat(1600)
      ].join("\n")
    });
    const aligned = commit({
      sha: "state001",
      message: "Refine StateGroup choices used by the state model workflow."
    });
    const meta = selectFocusCommitWithMeta({
      lineRange: { start: 14, end: 20 },
      introduction,
      recentCommits: [aligned],
      focusTerms: ["stategroup", "state", "group"],
      symbolTerms: ["stategroup"],
      filesChangedBySha: { "5933561": 87 }
    });
    assert.notEqual(meta.commit.sha, introduction.sha);
    assert.equal(meta.commit.sha, aligned.sha);
    assert.equal(meta.quality, "aligned");
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

  await test("Z3 Gate A: auth mega-PR must not become focus for StateGroup ask", () => {
    const introduction = commit({
      sha: "intro001",
      message: "Initial models for plane db state helpers."
    });
    const authMega = commit({
      sha: "5933561",
      message: [
        "feat: session auth implementation (#4411)",
        "",
        "* chore: instance empty state for god-mode.",
        "* fix: state of the session store",
        "x".repeat(1600)
      ].join("\n")
    });
    const focus = selectFocusCommit({
      introduction,
      recentCommits: [authMega],
      focusTerms: ["stategroup", "state", "group"],
      symbolTerms: ["stategroup"]
    });
    assert.notEqual(focus.sha, authMega.sha, "auth mega must not win");
    assert.equal(focus.sha, introduction.sha);
  });

  await test("Z3 Gate A: prefers StateGroup-aligned commit deeper in score window", () => {
    const introduction = commit({
      sha: "intro001",
      message: "Initial models for plane db helpers."
    });
    const authMega = commit({
      sha: "5933561",
      message: "feat: session auth implementation (#4411)\n\nempty state for god-mode\n" + "x".repeat(1600)
    });
    const noise = commit({
      sha: "noise002",
      message: "chore: bump dependency versions across workspace packages."
    });
    const aligned = commit({
      sha: "state9a1",
      message: "fix: refine StateGroup choices for backlog triage modeling."
    });
    const focus = selectFocusCommit({
      introduction,
      recentCommits: [authMega, noise, aligned],
      focusTerms: ["stategroup", "state"],
      symbolTerms: ["stategroup"]
    });
    assert.equal(focus.sha, aligned.sha);
  });

  await test("Z3 Gate B: mega drive-by with filesChanged is demoted when score is 0", () => {
    const introduction = commit({
      sha: "intro001",
      message: "Initial state model scaffold for plane."
    });
    const mega = commit({
      sha: "megaauth",
      message: "feat: session auth implementation across services (#4411)"
    });
    const meta = selectFocusCommitWithMeta({
      introduction,
      recentCommits: [mega],
      focusTerms: ["stategroup", "state"],
      filesChangedBySha: { megaauth: 87 }
    });
    assert.equal(meta.commit.sha, introduction.sha);
    assert.equal(meta.quality, "weak");
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
