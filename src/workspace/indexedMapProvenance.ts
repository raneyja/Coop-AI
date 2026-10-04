import type { StoredRepoStats } from "./repoStatsStore";

/** Old Deep-Index maps stamped every file with the same clone commit as repo_stats. */
export function legacyIndexedMapProvenance(
  files: Array<{ path: string; sha: string }>,
  stats: StoredRepoStats | undefined,
  requestedBranch: string
): { indexedBranch: string; indexedCommit: string } | undefined {
  const branch = stats?.branch?.trim();
  const commit = stats?.headCommit?.trim();
  if (!branch || branch !== requestedBranch || !commit || !/^[a-f0-9]{40,64}$/i.test(commit) ||
      files.length === 0 || files.length !== stats?.fileCount ||
      new Set(files.map((file) => file.path)).size !== files.length ||
      !files.every((file) => Boolean(file.path.trim()) && file.sha === commit)) {
    return undefined;
  }
  return { indexedBranch: branch, indexedCommit: commit };
}
