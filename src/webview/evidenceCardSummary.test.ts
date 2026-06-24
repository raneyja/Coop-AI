import assert from "node:assert/strict";
import type { BlastRadiusEvidence, SlackSearchEvidence } from "../context/contextBundleEvidence";
import type { DecisionTimeline } from "../types/decisionTimeline";
import type { OwnershipReport } from "../types/ownership";
import {
  dedupeLimitations,
  filterDetailWarnings,
  sourceContributionChipDetail,
  summarizeBlastRadius,
  summarizeDecisionTimeline,
  summarizeIntegrationSearch,
  summarizeOwnershipReport,
  summarizeRepoSummary
} from "./evidenceCardSummary";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

test("weak trace when only introducing commit exists", () => {
  const timeline: DecisionTimeline = {
    file: "src/service/handler.ts",
    originalCommit: {
      sha: "0123456789abcdef0123456789abcdef01234567",
      author: "alice",
      date: "2026-05-01T12:00:00Z",
      message: "fix"
    },
    alternatives: [],
    chronology: [],
    warnings: [],
    completeness: "minimal"
  };

  const summary = summarizeDecisionTimeline(timeline);
  assert.equal(summary.quality, "weak");
  assert.match(summary.primaryFinding ?? "", /Introduced in commit 0123456/);
  assert.ok(summary.limitations.some((line) => /No linked pull request/i.test(line)));
});

test("medium trace when commit links to thin PR context", () => {
  const timeline: DecisionTimeline = {
    file: "src/service/handler.ts",
    originalCommit: {
      sha: "89abcdef0123456789abcdef0123456789abcdef",
      author: "bob",
      date: "2026-06-01T12:00:00Z",
      message: "Add shared response handling for service retries and timeout edges"
    },
    linkedPR: {
      number: 322,
      title: "Refactor retry handler",
      description: "",
      state: "merged",
      labels: [],
      reviews: [],
      approvers: []
    },
    alternatives: [],
    chronology: [],
    warnings: [],
    completeness: "partial"
  };

  const summary = summarizeDecisionTimeline(timeline);
  assert.equal(summary.quality, "medium");
  assert.match(summary.primaryFinding ?? "", /PR #322/);
  assert.ok(summary.sourceContributions.some((entry) => entry.label.includes("PR #322")));
});

test("decision summary uses evolution and rationale ranking", () => {
  const timeline: DecisionTimeline = {
    file: "src/service/handler.ts",
    targetLabel: "src/service/handler.ts:20-40",
    originalCommit: {
      sha: "fedcba9876543210fedcba9876543210fedcba98",
      author: "carol",
      date: "2026-01-01T00:00:00Z",
      message: "Add resilient handler flow for API retries under partial outages"
    },
    introducingDiffSummary: {
      filesChanged: 3,
      insertions: 41,
      deletions: 9,
      summary: "Introducing commit changed 3 files (+41 / -9).",
      patchExcerpt: "const result = await withRetry(fetcher);"
    },
    evolution: {
      commitCountSinceIntroduction: 5,
      lastModifiedAt: "2026-06-18T12:30:00Z",
      lastModifiedAuthor: "@dana"
    },
    linkedPR: {
      number: 410,
      title: "Harden handler retry path",
      description: "Adds retry, timeout guards, and fallback handling.",
      state: "merged",
      labels: [],
      reviews: [],
      approvers: ["dana"]
    },
    rationaleRanking: [
      { source: "pr:410", role: "rationale", label: "PR #410" },
      { source: "commit:fedcba9", role: "provenance", label: "Commit fedcba9" }
    ],
    alternatives: [],
    chronology: [],
    warnings: [],
    completeness: "partial"
  };

  const summary = summarizeDecisionTimeline(timeline);
  assert.equal(summary.target, "src/service/handler.ts:20-40");
  assert.match(summary.primaryFinding ?? "", /5 commit\(s\) touched this file since introduction/i);
  const commitSource = summary.sourceContributions.find((entry) => /commit/i.test(entry.label));
  const prSource = summary.sourceContributions.find((entry) => /PR #410/i.test(entry.label));
  assert.equal(commitSource?.relevance, "supporting");
  assert.equal(prSource?.relevance, "direct");
  assert.match(commitSource?.contribution ?? "", /Introducing commit changed 3 files/i);
});

test("commit-only trace with good message stays weak without cross-tool evidence", () => {
  const timeline: DecisionTimeline = {
    file: "src/server/githubAppApi.ts",
    originalCommit: {
      sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      author: "eve",
      date: "2026-05-01T10:00:00Z",
      message: "Add robust GitHub App API validation helpers for trace decision tests"
    },
    alternatives: [],
    chronology: [{ date: "2026-05-01", actor: "eve", event: "Code originally introduced", evidence: "commit" }],
    warnings: ["No linked pull request found for the introducing commit."],
    completeness: "minimal"
  };

  const summary = summarizeDecisionTimeline(timeline);
  assert.equal(summary.quality, "weak");
});

test("commit-only rationale adds limitation", () => {
  const timeline: DecisionTimeline = {
    file: "src/service/handler.ts",
    originalCommit: {
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      author: "eve",
      date: "2026-05-01T10:00:00Z",
      message: "Add robust request-scoped cache invalidation for stale fallback handling"
    },
    rationaleRanking: [
      { source: "commit:aaaaaaaa", role: "rationale", label: "Commit aaaaaaa" }
    ],
    alternatives: [],
    chronology: [],
    warnings: [],
    completeness: "minimal"
  };

  const summary = summarizeDecisionTimeline(timeline);
  assert.ok(
    summary.limitations.some((line) =>
      /Rationale is inferred only from commit metadata/i.test(line)
    )
  );
});

test("ownership summary highlights primary owner", () => {
  const report: OwnershipReport = {
    path: "src/api/client.ts",
    owner: "coop-ai",
    repo: "extension",
    scores: [
      {
        owner: "alice",
        score: 92,
        tier: "primary",
        commitCount: 14,
        reviewApprovals: 5,
        issueResolutions: 2,
        activityWeight: 1,
        role: "both"
      },
      {
        owner: "bob",
        score: 58,
        tier: "secondary",
        commitCount: 7,
        reviewApprovals: 4,
        issueResolutions: 1,
        activityWeight: 0.6,
        role: "reviewer"
      }
    ],
    teamGraph: {
      members: [],
      escalationPath: "Start with @alice, then #platform-help"
    },
    orgContext: {
      teamName: "Platform",
      members: ["alice", "bob"],
      source: "codeowners"
    },
    risk: {
      singlePointOfFailure: false,
      expertUnavailable: false,
      orphaned: false,
      highTurnover: false,
      teamDispersion: false
    },
    history: [],
    messageDraft: {
      recipient: "alice",
      text: "Can you sanity check this API change?"
    },
    warnings: [],
    completeness: "full"
  };

  const slackSearch: SlackSearchEvidence = { messages: [] };
  const summary = summarizeOwnershipReport(report, slackSearch);
  assert.match(summary.primaryFinding ?? "", /@alice is the primary owner/i);
  assert.ok(summary.sourceContributions.some((entry) => entry.provider === "github"));
  assert.ok(summary.recommendedActions.some((action) => action.kind === "open-file"));
});

test("blast radius summary handles no dependents with unverified messaging", () => {
  const evidence: BlastRadiusEvidence = {
    file: "src/server/routes.ts",
    directDependents: [],
    graphMeta: { edgeCount: 102, source: "remote", lightningEnabled: false },
    warnings: []
  };

  const summary = summarizeBlastRadius(evidence, "src/server/routes.ts");
  assert.equal(summary.quality, "weak");
  assert.match(summary.primaryFinding ?? "", /Impact unverified/i);
  assert.ok(summary.limitations.some((line) => /Impact unverified/i.test(line)));
  assert.ok(summary.recommendedActions.some((action) => action.kind === "open-lightning"));
  assert.ok(
    !summary.recommendedActions.some(
      (action) => action.kind === "quick-action" && action.quickActionId === "blast-radius"
    )
  );
});

test("integration summary marks empty result sets as weak", () => {
  const summary = summarizeIntegrationSearch("slack", { messages: [] });
  assert.equal(summary.quality, "weak");
  assert.match(summary.primaryFinding ?? "", /No matching slack results/i);
  assert.ok(summary.recommendedActions.some((action) => action.kind === "search"));
});

test("integration summary includes open action for teams links", () => {
  const summary = summarizeIntegrationSearch("teams", {
    messages: [{ text: "Discussed rollout steps", fromUserName: "alex", webUrl: "https://teams.example.com/message/1" }]
  });
  assert.ok(
    summary.recommendedActions.some(
      (action) => action.kind === "open-url" && action.url === "https://teams.example.com/message/1"
    )
  );
});

test("dedupeLimitations collapses semantically duplicate PR warnings", () => {
  const deduped = dedupeLimitations([
    "No linked pull request was found for this decision trace.",
    "No linked pull request found for the introducing commit."
  ]);
  assert.equal(deduped.length, 1);
});

test("sourceContributionChipDetail strips citation wrapper", () => {
  assert.equal(
    sourceContributionChipDetail("[Sources: GitHub commit dd2bb73]"),
    "GitHub commit dd2bb73"
  );
});

test("filterDetailWarnings removes warnings already covered by limitations", () => {
  const limitations = ["No linked pull request was found for this decision trace."];
  const warnings = ["No linked pull request found for the introducing commit."];
  assert.deepEqual(filterDetailWarnings(warnings, limitations), []);
});

test("weak trace dedupes timeline warning into limitations", () => {
  const timeline: DecisionTimeline = {
    file: "fastify.js",
    originalCommit: {
      sha: "dd2bb7312345678901234567890123456789012",
      author: "@mcollina",
      date: "2016-10-04T16:03:00Z",
      message: "Some random code."
    },
    alternatives: [],
    chronology: [],
    warnings: ["No linked pull request found for the introducing commit."],
    completeness: "minimal"
  };

  const summary = summarizeDecisionTimeline(timeline);
  assert.equal(summary.limitations.filter((line) => /pull request/i.test(line)).length, 1);
});

test("repo summary reaches strong without manifest when anchors and Notion hits exist", () => {
  const summary = summarizeRepoSummary(
    {
      entryFiles: [{ path: "src/extension.ts" }],
      notion: {
        pages: [{ id: "1", title: "Architecture Overview", url: "https://notion.example/arch" }]
      }
    },
    "coop-ai",
    "extension"
  );
  assert.equal(summary.quality, "strong");
  assert.ok(
    !summary.limitations.some((line) => /Confluence and Jira architecture context were not attached/i.test(line))
  );
  assert.ok(summary.sourceContributions.some((entry) => entry.provider === "notion"));
});

test("repo summary counts Slack and Teams in external integration signals", () => {
  const summary = summarizeRepoSummary(
    {
      entryFiles: [{ path: "package.json" }],
      slack: {
        messages: [{ text: "Discussed rollout", channelName: "eng" }]
      },
      teams: {
        messages: [{ text: "Teams rollout thread", fromUserName: "Alex" }]
      }
    },
    "coop-ai",
    "extension"
  );
  assert.match(summary.primaryFinding ?? "", /2 external integration signal/i);
  assert.ok(summary.sourceContributions.some((entry) => entry.provider === "slack"));
  assert.ok(summary.sourceContributions.some((entry) => entry.provider === "teams"));
});

test("repo summary omits ownership and dependency card rows when not checklist-backed", () => {
  const summary = summarizeRepoSummary(
    {
      entryFiles: [{ path: "src/extension.ts" }],
      relatedOwnership: { owner: "alice", path: "src/extension.ts" },
      dependencyGraph: { edgeCount: 42 }
    },
    "coop-ai",
    "extension"
  );
  assert.ok(
    !summary.sourceContributions.some((entry) => /Ownership signals|Dependency graph/i.test(entry.label))
  );
});

const total = passed + failed;
console.log(`\nevidenceCardSummary: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
