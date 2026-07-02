import type { OrgPlan, OrgRepoRecord, OrgStore } from "./orgStore";
import type { OrgRepoAccessMode } from "./repoAccessTypes";
import { usesAdminRepoAccessPolicy } from "./repoAccessTypes";
import type { UserRepoGrantStore } from "./userRepoGrantStore";

export type AccessibleRepoResolution = {
  repoIds: string[];
  repoAccessMode: OrgRepoAccessMode | null;
  adminControlled: boolean;
};

export function isIndexedForAccess(repo: OrgRepoRecord): boolean {
  return Boolean(repo.lightningEnabled && repo.indexStatus !== "disabled");
}

export function indexedOrgRepoIds(repos: OrgRepoRecord[]): string[] {
  return repos.filter(isIndexedForAccess).map((repo) => repo.repoId);
}

export async function resolveAccessibleRepoIds(
  orgId: string,
  userId: string,
  plan: OrgPlan,
  deps: { orgStore: OrgStore; grantStore?: UserRepoGrantStore }
): Promise<AccessibleRepoResolution> {
  const org = await deps.orgStore.getOrganization(orgId);
  const repoAccessMode = org?.repoAccessMode ?? "all_indexed";
  const adminControlled = usesAdminRepoAccessPolicy(plan);
  const orgRepos = await deps.orgStore.listOrgRepos(orgId);
  const indexedIds = indexedOrgRepoIds(orgRepos);

  if (!adminControlled) {
    return { repoIds: [], repoAccessMode: null, adminControlled: false };
  }

  if (repoAccessMode === "all_indexed") {
    return { repoIds: indexedIds, repoAccessMode, adminControlled: true };
  }

  if (!deps.grantStore || !userId || userId.startsWith("apikey:")) {
    return { repoIds: [], repoAccessMode, adminControlled: true };
  }

  const grants = await deps.grantStore.listUserRepoGrantIds(orgId, userId);
  const grantSet = new Set(grants);
  return {
    repoIds: indexedIds.filter((repoId) => grantSet.has(repoId)),
    repoAccessMode,
    adminControlled: true
  };
}

export function catalogRepoIsAccessible(
  repoId: string,
  indexedIds: string[],
  resolution: AccessibleRepoResolution
): boolean {
  if (!indexedIds.includes(repoId)) {
    return false;
  }
  if (!resolution.adminControlled) {
    return true;
  }
  if (resolution.repoAccessMode === "all_indexed") {
    return true;
  }
  return resolution.repoIds.includes(repoId);
}
