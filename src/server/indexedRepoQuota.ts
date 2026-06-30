import type { ServerResponse } from "node:http";
import type { OrgPlan, OrgStore } from "./orgStore";
import { PRICING_PAGE_URL } from "../config/siteConfig";

export const FREE_MAX_INDEXED_REPOS = 3;

/** Org catalog metrics — free orgs cap Deep-Index at 3 repos; Pro/Enterprise uncapped. */
export type IndexedRepoQuota = {
  indexedRepoCount: number;
  indexedRepoLimit: number | null;
  canEnableMoreRepos: boolean;
};

export type RepoLimitErrorBody = {
  error: "repo_limit";
  message: string;
  upgrade: "pro";
  upgradeUrl: string;
};

export function indexedRepoLimitForPlan(plan: OrgPlan): number | null {
  return plan === "free" ? FREE_MAX_INDEXED_REPOS : null;
}

/** Pro/Enterprise auto-queue on catalog sync; free orgs pick repos manually. */
export function autoIndexOnCatalogSync(plan: OrgPlan): boolean {
  return plan !== "free";
}

export async function countLightningEnabledRepos(orgStore: OrgStore, orgId: string): Promise<number> {
  const repos = await orgStore.listOrgRepos(orgId);
  return repos.filter((repo) => repo.lightningEnabled).length;
}

export async function getIndexedRepoQuota(
  orgStore: OrgStore,
  orgId: string,
  plan: OrgPlan
): Promise<IndexedRepoQuota> {
  const indexedRepoCount = await countLightningEnabledRepos(orgStore, orgId);
  const indexedRepoLimit = indexedRepoLimitForPlan(plan);
  return {
    indexedRepoCount,
    indexedRepoLimit,
    canEnableMoreRepos: indexedRepoLimit === null || indexedRepoCount < indexedRepoLimit
  };
}

export function writeRepoLimitForbidden(response: ServerResponse, plan: OrgPlan = "free"): void {
  const limit = indexedRepoLimitForPlan(plan) ?? FREE_MAX_INDEXED_REPOS;
  response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
  response.end(
    JSON.stringify({
      error: "repo_limit",
      message: `Your ${plan} plan can Deep-Index up to ${limit} repositories. Disable another repo or upgrade to Pro for unlimited indexing.`,
      upgrade: "pro",
      upgradeUrl: PRICING_PAGE_URL
    } satisfies RepoLimitErrorBody)
  );
}

/** Allow re-queuing repos already enabled; block net-new enables over the plan cap. */
export async function requireCanEnableMoreRepos(
  orgStore: OrgStore,
  orgId: string,
  plan: OrgPlan,
  response: ServerResponse,
  options?: { alreadyEnabled?: boolean }
): Promise<boolean> {
  if (options?.alreadyEnabled) {
    return true;
  }
  const quota = await getIndexedRepoQuota(orgStore, orgId, plan);
  if (quota.canEnableMoreRepos) {
    return true;
  }
  writeRepoLimitForbidden(response, plan);
  return false;
}
