import assert from "node:assert/strict";
import type { BlastRadiusEvidence, KnowledgeGapsEvidence, RepoSummaryEvidence } from "../context/contextBundleEvidence";
import type { DecisionTimeline } from "../types/decisionTimeline";
import type { OwnershipReport } from "../types/ownership";
import {
  buildSearchFollowup,
  capEvidenceActions,
  executeEvidenceAction,
  type EvidenceRecommendedAction
} from "./evidenceCardActionHandler";
import {
  summarizeBlastRadius,
  summarizeDecisionTimeline,
  summarizeIntegrationSearch,
  summarizeKnowledgeGaps,
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

test("executeEvidenceAction opens urls", () => {
  let opened: string | undefined;
  executeEvidenceAction(
    { label: "Open commit", kind: "open-url", url: "https://example.com/commit/1" },
    {
      onOpenLink: (url) => {
        opened = url;
      }
    }
  );
  assert.equal(opened, "https://example.com/commit/1");
});

test("executeEvidenceAction opens files with preserved context", () => {
  let openedPath: string | undefined;
  let openedLine: number | undefined;
  let preserveContext: boolean | undefined;
  executeEvidenceAction(
    { label: "Open file", kind: "open-file", path: "src/api/client.ts", line: 42 },
    {
      onOpenFile: (path, line, options) => {
        openedPath = path;
        openedLine = line;
        preserveContext = options?.preserveContext;
      }
    }
  );
  assert.equal(openedPath, "src/api/client.ts");
  assert.equal(openedLine, 42);
  assert.equal(preserveContext, true);
});

test("search actions build contextual composer follow-up", () => {
  let followup: string | undefined;
  executeEvidenceAction(
    {
      label: "Search Jira",
      kind: "search",
      searchType: "jira",
      path: "src/auth/session.ts"
    },
    {
      onComposerFollowup: (text) => {
        followup = text;
      },
      repoContext: { owner: "coop-ai", repo: "extension", branch: "main" }
    }
  );
  assert.ok(followup);
  assert.match(followup ?? "", /Search Jira/i);
  assert.match(followup ?? "", /src\/auth\/session\.ts/i);
  assert.match(followup ?? "", /coop-ai\/extension/i);
});

test("capEvidenceActions enforces action limit", () => {
  const actions: EvidenceRecommendedAction[] = [
    { label: "One", kind: "search", searchType: "generic" },
    { label: "Two", kind: "search", searchType: "generic" },
    { label: "Three", kind: "search", searchType: "generic" },
    { label: "Four", kind: "search", searchType: "generic" }
  ];
  const capped = capEvidenceActions(actions, 3);
  assert.equal(capped.length, 3);
  assert.deepEqual(capped.map((entry) => entry.label), ["One", "Two", "Three"]);
});

test("buildSearchFollowup uses custom prompt when provided", () => {
  const prompt = buildSearchFollowup(
    {
      label: "Refine search",
      kind: "search",
      searchType: "integration",
      composerPrompt: "Search for more Slack threads about deployment freezes."
    },
    {}
  );
  assert.equal(prompt, "Search for more Slack threads about deployment freezes.");
});

test("quick-action runs find-owner via slash-style follow-up", () => {
  let actionId: string | undefined;
  let targetPath: string | undefined;
  executeEvidenceAction(
    {
      label: "Find owner",
      kind: "quick-action",
      quickActionId: "find-owner",
      path: "package.json"
    },
    {
      onQuickAction: (id, path) => {
        actionId = id;
        targetPath = path;
      }
    }
  );
  assert.equal(actionId, "find-owner");
  assert.equal(targetPath, "package.json");
});

test("normalizers output capped dispatcher-compatible actions", () => {
  const ownershipReport: OwnershipReport = {
    path: "src/api/client.ts",
    owner: "coop-ai",
    repo: "extension",
    scores: [],
    teamGraph: { members: [], escalationPath: "Escalate to #platform-help" },
    orgContext: {
      teamName: "Platform",
      members: ["alice"],
      source: "codeowners",
      htmlUrl: "https://github.com/orgs/coop-ai/teams/platform"
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
      text: "Could you take a quick look at this path?"
    },
    warnings: [],
    completeness: "full"
  };

  const decisionTimeline: DecisionTimeline = {
    file: "src/api/client.ts",
    originalCommit: {
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      author: "alice",
      date: "2026-06-01T10:00:00Z",
      message: "Introduce shared action handling for evidence cards"
    },
    linkedPR: {
      number: 12,
      title: "Add action dispatcher",
      description: "",
      state: "merged",
      labels: [],
      reviews: [],
      approvers: [],
      htmlUrl: "https://github.com/coop-ai/extension/pull/12"
    },
    rationaleRanking: [],
    alternatives: [],
    chronology: [],
    warnings: [],
    completeness: "partial"
  };

  const blastEvidence: BlastRadiusEvidence = {
    directDependents: ["src/webview/ChatPanel.tsx"],
    warnings: []
  };

  const gapsEvidence: KnowledgeGapsEvidence = {
    file: "src/webview/ChatPanel.tsx",
    warnings: []
  };

  const repoEvidence: RepoSummaryEvidence = {
    entryFiles: [{ path: "src/extension.ts" }],
    confluence: { pages: [{ id: "1", title: "Architecture", htmlUrl: "https://wiki.example.com/architecture" }] },
    warnings: []
  };

  const summaries = [
    summarizeOwnershipReport(ownershipReport),
    summarizeDecisionTimeline(decisionTimeline),
    summarizeBlastRadius(blastEvidence, "src/webview/ChatPanel.tsx"),
    summarizeKnowledgeGaps(gapsEvidence, "src/webview/ChatPanel.tsx"),
    summarizeRepoSummary(repoEvidence, "coop-ai", "extension"),
    summarizeIntegrationSearch("slack", { messages: [] })
  ];

  for (const summary of summaries) {
    assert.ok(summary.recommendedActions.length <= 3);
    for (const action of summary.recommendedActions) {
      assert.ok(
        action.kind === "open-file" ||
          action.kind === "open-url" ||
          action.kind === "search" ||
          action.kind === "quick-action",
        `Unexpected action kind: ${action.kind}`
      );
    }
  }
});

const total = passed + failed;
console.log(`\nevidenceCardActionHandler: ${passed}/${total} tests passed`);
if (failed > 0) {
  process.exit(1);
}
