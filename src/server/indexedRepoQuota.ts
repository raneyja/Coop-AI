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

/** Admins explicitly choose repos to Deep-Index after catalog discovery. */
export function autoIndexOnCatalogSync(_plan: OrgPlan): boolean {
  return false;
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

export type ReconcileIndexedRepoQuotaResult = {
  trimmed: number;
  disabledRepoIds: string[];
};

/**
 * Free-plan safety net: if more than the plan cap are Deep-Indexed (legacy data, plan
 * downgrade, or pre-cap testing), disable the excess. Keeps the most recently indexed repos.
 */
export async function reconcileIndexedRepoQuota(
  orgStore: OrgStore,
  orgId: string,
  plan: OrgPlan
): Promise<ReconcileIndexedRepoQuotaResult> {
  const limit = indexedRepoLimitForPlan(plan);
  if (limit === null) {
    return { trimmed: 0, disabledRepoIds: [] };
  }

  const repos = await orgStore.listOrgRepos(orgId);
  const enabled = repos.filter((repo) => repo.lightningEnabled);
  if (enabled.length <= limit) {
    return { trimmed: 0, disabledRepoIds: [] };
  }

  const sorted = [...enabled].sort((a, b) => {
    const aTime = a.lastIndexedAt ? new Date(a.lastIndexedAt).getTime() : 0;
    const bTime = b.lastIndexedAt ? new Date(b.lastIndexedAt).getTime() : 0;
    if (bTime !== aTime) {
      return bTime - aTime;
    }
    return a.repoId.localeCompare(b.repoId);
  });

  const keep = new Set(sorted.slice(0, limit).map((repo) => repo.repoId));
  const disabledRepoIds: string[] = [];
  for (const repo of enabled) {
    if (keep.has(repo.repoId)) {
      continue;
    }
    await orgStore.upsertOrgRepo(orgId, repo.repoId, {
      lightningEnabled: false,
      indexStatus: "disabled"
    });
    disabledRepoIds.push(repo.repoId);
  }

  if (disabledRepoIds.length > 0) {
    console.log(
      `[indexed-repo-quota] org=${orgId} plan=${plan} disabled ${disabledRepoIds.length} excess Deep-Indexed repos (limit ${limit})`
    );
  }

  return { trimmed: disabledRepoIds.length, disabledRepoIds };
}
