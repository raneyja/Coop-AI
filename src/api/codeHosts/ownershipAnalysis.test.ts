import assert from "node:assert/strict";
import {
  analyzeCommitPatterns,
  calculateOwnershipScores,
  mergeOwnershipScoreIdentities
} from "./ownershipAnalysis";
import type { OwnershipScore, OwnershipSignals } from "../../types/ownership";
import type { CommitInfo } from "./types";
import type { IdentityDirectory } from "../../identity/types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

const nowIso = new Date().toISOString();

test("calculateOwnershipScores propagates github login from commit stats", () => {
  const signals: OwnershipSignals = {
    commits: [
      {
        author: "raneyja",
        authorLogin: "raneyja",
        counts: { sixMonths: 2, oneYear: 2, allTime: 2 },
        recencyScore: 2,
        lastCommitDate: nowIso,
        messages: []
      }
    ],
    reviews: [],
    issues: [],
    specialties: [],
    activity: [
      {
        author: "raneyja",
        lastActiveDate: nowIso,
        weight: 1,
        inactive: false
      }
    ]
  };

  const scores = calculateOwnershipScores(signals);
  assert.equal(scores.length, 1);
  assert.equal(scores[0]?.owner, "raneyja");
  assert.equal(scores[0]?.githubLogin, "raneyja");
});

test("analyzeCommitPatterns merges display name and github login into one author", () => {
  const commits: CommitInfo[] = [
    {
      sha: "a",
      author: "Jon Raney",
      authorLogin: "jonraney",
      date: nowIso,
      message: "feat: with login"
    },
    {
      sha: "b",
      author: "Jon Raney",
      date: nowIso,
      message: "chore: name only (no linked user)"
    }
  ];

  const stats = analyzeCommitPatterns(commits);
  assert.equal(stats.length, 1, "expected a single merged author");
  assert.equal(stats[0]?.author, "jonraney");
  assert.equal(stats[0]?.authorLogin, "jonraney");
  assert.equal(stats[0]?.counts.allTime, 2);
});

test("calculateOwnershipScores does not split login vs display name", () => {
  const commits = analyzeCommitPatterns([
    {
      sha: "a",
      author: "Jon Raney",
      authorLogin: "jonraney",
      date: nowIso,
      message: "with login"
    },
    {
      sha: "b",
      author: "Jon Raney",
      date: nowIso,
      message: "name only"
    }
  ]);

  const signals: OwnershipSignals = {
    commits,
    reviews: [
      {
        author: "jonraney",
        approvals: 2,
        reviews: 2,
        recencyScore: 4,
        lastReviewDate: nowIso,
        isReviewerOnly: false
      }
    ],
    issues: [],
    specialties: [],
    activity: [
      {
        author: "jonraney",
        lastActiveDate: nowIso,
        weight: 1,
        inactive: false
      }
    ]
  };

  const scores = calculateOwnershipScores(signals);
  assert.equal(scores.length, 1);
  assert.equal(scores[0]?.owner, "jonraney");
  assert.equal(scores[0]?.githubLogin, "jonraney");
  assert.ok((scores[0]?.commitCount ?? 0) >= 1);
  assert.ok((scores[0]?.reviewApprovals ?? 0) >= 1);
});

test("mergeOwnershipScoreIdentities merges via identity directory", () => {
  const directory: IdentityDirectory = {
    version: 1,
    people: [
      {
        id: "p1",
        displayName: "Jon Raney",
        links: [{ provider: "github", externalId: "jonraney" }]
      }
    ]
  };

  const scores: OwnershipScore[] = [
    {
      owner: "Jon Raney",
      score: 40,
      tier: "secondary",
      commitCount: 3,
      reviewApprovals: 0,
      issueResolutions: 0,
      activityWeight: 1,
      role: "author"
    },
    {
      owner: "jonraney",
      githubLogin: "jonraney",
      score: 90,
      tier: "primary",
      commitCount: 0,
      reviewApprovals: 4,
      issueResolutions: 0,
      activityWeight: 1,
      role: "reviewer"
    }
  ];

  const merged = mergeOwnershipScoreIdentities(scores, directory);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.owner, "jonraney");
  assert.equal(merged[0]?.githubLogin, "jonraney");
  assert.equal(merged[0]?.role, "both");
  assert.equal(merged[0]?.commitCount, 3);
  assert.equal(merged[0]?.reviewApprovals, 4);
});

console.log(`\nownershipAnalysis: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
