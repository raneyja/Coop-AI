/**
 * Rigorous multi-host evidence parity checks.
 * Run: npx tsx src/webview/evidenceCodeHostParity.test.ts
 */
import assert from "node:assert/strict";
import { resolveEvidenceCodeHost, evidenceCodeHostDisplayName } from "../api/codeHosts/codeHostLabels";
import { parseRepoId } from "../jobs/buildStructureManifest";
import { coordinatesFromRepoId } from "../api/codeHosts/types";
import { isRemoteFileSearchFallbackCandidate } from "../api/codeHosts/cloudRepoFileSearchFallback";
import {
  decisionSourceLabelCommit,
  decisionSourceLabelPr,
  listDecisionSourceLabels
} from "../prompts/decisionSourceLabels";
import { ownershipSourceLabelCodeHost, listOwnershipSourceLabels } from "../prompts/ownershipSourceLabels";
import {
  summarizeBlastRadius,
  summarizeDecisionTimeline,
  summarizeKnowledgeGaps,
  summarizeOwnershipReport,
  summarizeRepoSummary
} from "./evidenceCardSummary";
import { evidenceCodeHostConnection } from "./evidenceCodeHost";
import { codeHostOrgInstalled } from "./components/settings/subtitles";
import type { Preferences } from "./components/settings/types";
import type { BlastRadiusEvidence, KnowledgeGapsEvidence, RepoSummaryEvidence } from "../context/contextBundleEvidence";
import type { DecisionTimeline } from "../types/decisionTimeline";
import type { OwnershipReport } from "../types/ownership";

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

const HOSTS = ["github", "gitlab", "bitbucket"] as const;

test("resolveEvidenceCodeHost maps all three hosts and rejects unknowns to github only as last resort", () => {
  assert.equal(resolveEvidenceCodeHost("github"), "github");
  assert.equal(resolveEvidenceCodeHost("gitlab"), "gitlab");
  assert.equal(resolveEvidenceCodeHost("bitbucket"), "bitbucket");
  assert.equal(resolveEvidenceCodeHost(undefined), "github");
  assert.equal(evidenceCodeHostDisplayName("bitbucket"), "Bitbucket");
  assert.equal(evidenceCodeHostConnection("gitlab"), "gitlab");
});

test("parseRepoId keeps nested GitLab paths in parity with coordinatesFromRepoId", () => {
  for (const id of [
    "bitbucket:coop-ai/plane",
    "gitlab:group/project",
    "gitlab:group/sub/project",
    "github:coop-ai/plane"
  ]) {
    const parsed = parseRepoId(id);
    const coords = coordinatesFromRepoId(id);
    assert.ok(coords);
    assert.equal(parsed.owner, coords!.owner);
    assert.equal(parsed.repo, coords!.repo);
  }
  const nested = parseRepoId("gitlab:acme/platform/api");
  assert.equal(nested.owner, "acme");
  assert.equal(nested.repo, "platform/api");
});

test("search fallback treats Bitbucket/GitLab 400 and unsupported as recoverable", () => {
  assert.equal(isRemoteFileSearchFallbackCandidate(new Error("Request failed with status code 400")), true);
  assert.equal(
    isRemoteFileSearchFallbackCandidate(new Error("File search isn't supported for this code host yet.")),
    true
  );
  assert.equal(
    isRemoteFileSearchFallbackCandidate(new Error("You must enable Advanced Search to use this feature")),
    true
  );
});

test("Blast Radius source brands match each Use-repo host", () => {
  const evidence: BlastRadiusEvidence = {
    file: "apps/api/plane/db/models/state.py",
    directDependents: ["apps/api/plane/app/views/state.py"],
    docsReferences: [{ path: "docs/state.md", depth: 1, source: "docs" }],
    graphMeta: { edgeCount: 12, source: "import-parse", lightningEnabled: true },
    warnings: []
  };
  for (const host of HOSTS) {
    const summary = summarizeBlastRadius(evidence, evidence.file!, host);
    const codeHostRows = summary.sourceContributions.filter(
      (row) => row.provider === "github" || row.provider === "gitlab" || row.provider === "bitbucket"
    );
    assert.ok(codeHostRows.length > 0, `${host}: expected code-host contributions`);
    assert.ok(
      codeHostRows.every((row) => row.provider === host),
      `${host}: got ${codeHostRows.map((r) => r.provider).join(",")}`
    );
  }
});

test("Find Owner source brands match each Use-repo host", () => {
  const base: OwnershipReport = {
    path: "apps/api/plane/db/models/state.py",
    owner: "coop-ai",
    repo: "plane",
    scores: [
      {
        owner: "alice",
        tier: "primary",
        score: 0.9,
        commitCount: 10,
        reviewApprovals: 2,
        issueResolutions: 0,
        activityWeight: 1,
        role: "both"
      }
    ],
    teamGraph: { members: [], escalationPath: "Start with @alice" },
    risk: {
      singlePointOfFailure: false,
      expertUnavailable: false,
      orphaned: false,
      highTurnover: false,
      teamDispersion: false
    },
    history: [],
    messageDraft: { recipient: "alice", text: "hi" },
    warnings: [],
    completeness: "full"
  };
  for (const host of HOSTS) {
    const summary = summarizeOwnershipReport({ ...base, provider: host }, undefined, host);
    const codeHostRows = summary.sourceContributions.filter(
      (row) => row.provider === "github" || row.provider === "gitlab" || row.provider === "bitbucket"
    );
    assert.ok(codeHostRows.every((row) => row.provider === host), host);
    assert.equal(ownershipSourceLabelCodeHost(host), `[Sources: ${evidenceCodeHostDisplayName(host)} commits & reviews]`);
    const labels = listOwnershipSourceLabels({ ...base, provider: host });
    assert.ok(labels[0]?.includes(evidenceCodeHostDisplayName(host)));
  }
});

test("Trace Decision commit/PR labels match each Use-repo host", () => {
  const timeline: DecisionTimeline = {
    file: "apps/api/plane/db/models/state.py",
    completeness: "partial",
    originalCommit: {
      sha: "deadbeef012345",
      author: "dev",
      date: "2024-01-01T00:00:00Z",
      message: "Introduce state model"
    },
    linkedPR: {
      number: 42,
      title: "State",
      description: "Adds state",
      state: "merged",
      labels: [],
      reviews: [],
      approvers: []
    },
    alternatives: [],
    chronology: [],
    warnings: []
  };
  for (const host of HOSTS) {
    const summary = summarizeDecisionTimeline({ ...timeline, provider: host }, host);
    const codeHostRows = summary.sourceContributions.filter(
      (row) => row.provider === "github" || row.provider === "gitlab" || row.provider === "bitbucket"
    );
    assert.ok(codeHostRows.every((row) => row.provider === host), host);
    assert.equal(
      decisionSourceLabelCommit("deadbeef012345", host),
      `[Sources: ${evidenceCodeHostDisplayName(host)} commit deadbee]`
    );
    const prLabel = decisionSourceLabelPr(42, host);
    if (host === "gitlab") {
      assert.equal(prLabel, "[Sources: MR #42]");
    } else {
      assert.equal(prLabel, "[Sources: PR #42]");
    }
    const labels = listDecisionSourceLabels({ ...timeline, provider: host });
    assert.ok(labels.some((label) => label.includes(evidenceCodeHostDisplayName(host))));
  }
});

test("Understand Repo source brands match each Use-repo host", () => {
  const evidence: RepoSummaryEvidence = {
    entryFiles: [{ path: "README.md", content: "# Plane" }],
    manifest: { fileCount: 100 },
    warnings: []
  };
  for (const host of HOSTS) {
    const summary = summarizeRepoSummary(evidence, "coop-ai", "plane", host);
    const codeHostRows = summary.sourceContributions.filter(
      (row) => row.provider === "github" || row.provider === "gitlab" || row.provider === "bitbucket"
    );
    assert.ok(codeHostRows.length > 0, host);
    assert.ok(codeHostRows.every((row) => row.provider === host), host);
  }
});

test("Knowledge Gaps source brands match each Use-repo host", () => {
  const evidence: KnowledgeGapsEvidence = {
    file: "apps/api/plane/db/models/state.py",
    jobScan: { foundGaps: 1, highPriority: 0, mediumPriority: 1, lowPriority: 0, gaps: [] },
    ownershipReport: {
      path: "apps/api/plane/db/models/state.py",
      owner: "coop-ai",
      repo: "plane",
      scores: [],
      teamGraph: { members: [], escalationPath: "" },
      risk: {
        singlePointOfFailure: false,
        expertUnavailable: false,
        orphaned: false,
        highTurnover: false,
        teamDispersion: false
      },
      history: [],
      messageDraft: { recipient: "", text: "" },
      warnings: [],
      completeness: "minimal"
    },
    dependencyGraph: { edgeCount: 3, directDependents: ["a.py"] },
    warnings: []
  };
  for (const host of HOSTS) {
    const summary = summarizeKnowledgeGaps(evidence, evidence.file, undefined, undefined, undefined, undefined, undefined, undefined, host);
    const codeHostRows = summary.sourceContributions.filter(
      (row) => row.provider === "github" || row.provider === "gitlab" || row.provider === "bitbucket"
    );
    assert.ok(codeHostRows.length > 0, host);
    assert.ok(codeHostRows.every((row) => row.provider === host), `${host}: ${codeHostRows.map((r) => r.provider)}`);
  }
});

test("Settings hide developer fallback when org OAuth is installed", () => {
  const prefs = {
    devMode: true,
    hasGitHubAppInstalled: true,
    hasGitLabAppInstalled: true,
    hasBitbucketAppInstalled: true,
    hasGitHubToken: true,
    hasGitLabToken: false,
    hasBitbucketCredentials: false
  } as Preferences;
  assert.equal(codeHostOrgInstalled(prefs, "github"), true);
  assert.equal(codeHostOrgInstalled(prefs, "gitlab"), true);
  assert.equal(codeHostOrgInstalled(prefs, "bitbucket"), true);
  const disconnected = {
    ...prefs,
    hasBitbucketAppInstalled: false
  } as Preferences;
  assert.equal(codeHostOrgInstalled(disconnected, "bitbucket"), false);
});

console.log(`\nevidenceCodeHostParity: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  process.exit(1);
}
