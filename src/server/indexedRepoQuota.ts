import type { OrgPlan, OrgStore } from "./orgStore";

/** Org catalog metrics — indexing is not capped at org level; users pick up to 3 repos each. */
export type IndexedRepoQuota = {
  indexedRepoCount: number;
  indexedRepoLimit: number | null;
  canEnableMoreRepos: boolean;
};

export type RepoLimitErrorBody = {
  error: "repo_limit";
  message: string;
  upgrade: "enterprise";
};

export async function countLightningEnabledRepos(orgStore: OrgStore, orgId: string): Promise<number> {
  const repos = await orgStore.listOrgRepos(orgId);
  return repos.filter((repo) => repo.lightningEnabled).length;
}

export async function getIndexedRepoQuota(
  orgStore: OrgStore,
  orgId: string,
  _plan: OrgPlan
): Promise<IndexedRepoQuota> {
  const indexedRepoCount = await countLightningEnabledRepos(orgStore, orgId);
  return {
    indexedRepoCount,
    indexedRepoLimit: null,
    canEnableMoreRepos: true
  };
}
