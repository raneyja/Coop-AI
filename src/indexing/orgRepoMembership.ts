import type { Pool } from "pg";
import { OrgStore } from "../server/orgStore";
import { resolveAccessibleRepoIds } from "../server/resolveAccessibleRepos";
import { UserRepoGrantStore } from "../server/userRepoGrantStore";

export type RepoAccessCaller = {
  /** Human user id. Org API keys omit this. */
  userId?: string;
  /**
   * When true and the org is `per_user`, intersect with `user_repo_grants`
   * via `resolveAccessibleRepoIds`. Org API keys leave this false.
   */
  enforceUserGrants?: boolean;
};

/**
 * Repo ids in `candidates` that belong to `orgId`'s catalog.
 * Unknown ids are dropped. Org id always comes from auth, never the client body.
 */
export async function filterReposOwnedByOrg(
  pool: Pool,
  orgId: string,
  candidates: string[],
  caller?: RepoAccessCaller
): Promise<string[]> {
  const unique = [...new Set(candidates.filter((id) => id.trim().length > 0))];
  if (!orgId || unique.length === 0) {
    return [];
  }

  const ownedResult = await pool.query<{ repo_id: string }>(
    `SELECT repo_id FROM org_repos WHERE org_id = $1 AND repo_id = ANY($2::varchar[])`,
    [orgId, unique]
  );
  const owned = new Set(ownedResult.rows.map((row) => String(row.repo_id)));
  let filtered = unique.filter((id) => owned.has(id));
  if (filtered.length === 0) {
    return [];
  }

  if (caller?.enforceUserGrants && caller.userId && !caller.userId.startsWith("apikey:")) {
    const orgStore = new OrgStore(pool);
    const org = await orgStore.getOrganization(orgId);
    if (org?.repoAccessMode === "per_user") {
      const resolution = await resolveAccessibleRepoIds(orgId, caller.userId, org.plan, {
        orgStore,
        grantStore: new UserRepoGrantStore(pool)
      });
      const allowed = new Set(resolution.repoIds);
      filtered = filtered.filter((id) => allowed.has(id));
    }
  }

  return filtered;
}

export async function orgOwnsRepo(
  pool: Pool,
  orgId: string,
  repoId: string,
  caller?: RepoAccessCaller
): Promise<boolean> {
  const owned = await filterReposOwnedByOrg(pool, orgId, [repoId], caller);
  return owned.includes(repoId);
}
