import assert from "node:assert/strict";
import {
  buildIndexingQueue,
  codeHostBadgeLabel,
  computeIndexingStats,
  filterReposForIndexingView,
  formatEmbeddingBadgeLabel,
  hasEmbeddingWarning,
  parseCodeHostFromRepoId,
  shortRepoName,
  sortReposForIndexingView
} from "./indexingProgress";
import type { OrgRepoRecord } from "./coopApi";

void (async () => {
  const repos: OrgRepoRecord[] = [
    { repoId: "a", lightningEnabled: true, indexStatus: "ready", embeddingStatus: "complete" },
    {
      repoId: "b",
      lightningEnabled: true,
      indexStatus: "ready",
      embeddingStatus: "failed",
      embeddingError: "429 TPM"
    },
    { repoId: "c", lightningEnabled: true, indexStatus: "error", error: "clone failed" },
    { repoId: "d", lightningEnabled: true, indexStatus: "indexing" }
  ];

  const stats = computeIndexingStats(repos);
  assert.equal(stats.ready, 2);
  assert.equal(stats.readyWithEmbeddingWarning, 1);
  assert.equal(stats.error, 1);
  assert.equal(stats.indexing, 1);
  assert.equal(stats.progressPercent, 60);

  assert.equal(hasEmbeddingWarning(repos[1]), true);
  assert.equal(hasEmbeddingWarning(repos[0]), false);

  const queue = buildIndexingQueue(repos);
  assert.equal(queue.inFlight.length, 1);
  assert.equal(queue.attention.length, 2);
  assert.equal(queue.ready.length, 1);
  assert.equal(shortRepoName("github:acme/r1"), "acme/r1");

  const sorted = sortReposForIndexingView(repos);
  assert.equal(sorted[0]?.indexStatus, "indexing");

  assert.equal(parseCodeHostFromRepoId("github:acme/r1"), "github");
  assert.equal(parseCodeHostFromRepoId("gitlab:acme/r1"), "gitlab");
  assert.equal(codeHostBadgeLabel("github:acme/r1"), "GitHub");
  assert.equal(formatEmbeddingBadgeLabel(repos[1]), "Failed");
  assert.equal(formatEmbeddingBadgeLabel(repos[0]), "Complete");
  assert.equal(
    formatEmbeddingBadgeLabel({
      repoId: "queued-old",
      lightningEnabled: true,
      indexStatus: "queued",
      embeddingStatus: "complete"
    }),
    "—"
  );
  assert.equal(
    formatEmbeddingBadgeLabel({
      repoId: "indexing",
      lightningEnabled: true,
      indexStatus: "indexing",
      embeddingStatus: "complete"
    }),
    "Pending"
  );
  assert.equal(
    formatEmbeddingBadgeLabel({ repoId: "x", indexStatus: "ready", lightningEnabled: true }),
    "Not recorded"
  );

  const filtered = filterReposForIndexingView(repos, "clone");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.repoId, "c");

  const hostFiltered = filterReposForIndexingView(
    [
      { repoId: "github:a/b", lightningEnabled: true },
      { repoId: "gitlab:a/c", lightningEnabled: true }
    ],
    "",
    "gitlab"
  );
  assert.equal(hostFiltered.length, 1);
  assert.equal(hostFiltered[0]?.repoId, "gitlab:a/c");

  console.log("indexingProgress: 1/1 tests passed");
})();
