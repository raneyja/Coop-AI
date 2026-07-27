import type { OrgRepoRecord } from "./coopApi";
import { isUsableForDeveloperAccess } from "./usableRepos";

function isGrantableRepo(repo: OrgRepoRecord): boolean {
  return isUsableForDeveloperAccess(repo);
}

/** Keep only grants that still match a usable Deep-Indexed org repo. */
export function activeGrantRepoIds(grantIds: string[], repos: OrgRepoRecord[]): string[] {
  const indexed = new Set(repos.filter(isGrantableRepo).map((repo) => repo.repoId));
  return grantIds.filter((repoId) => indexed.has(repoId));
}
