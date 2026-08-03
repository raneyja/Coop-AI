import type { OrgRepoRecord } from "./coopApi";

function isDeepIndexedRepo(repo: OrgRepoRecord): boolean {
  return Boolean(repo.lightningEnabled && repo.indexStatus !== "disabled");
}

/** Keep only grants that still match a Deep-Indexed org repo (drop orphans). */
export function activeGrantRepoIds(grantIds: string[], repos: OrgRepoRecord[]): string[] {
  const indexed = new Set(repos.filter(isDeepIndexedRepo).map((repo) => repo.repoId));
  return grantIds.filter((repoId) => indexed.has(repoId));
}
