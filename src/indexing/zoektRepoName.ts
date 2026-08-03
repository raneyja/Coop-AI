import { parseRepoId } from "../server/gitCloneService";

/** Host-style path Zoekt historically used (no org). Kept for matching legacy shards. */
export function zoektHostRepoName(repoId: string): string {
  const { provider, owner, repo } = parseRepoId(repoId);
  if (provider === "gitlab") {
    return `gitlab.com/${owner}/${repo}`;
  }
  if (provider === "bitbucket") {
    return `bitbucket.org/${owner}/${repo}`;
  }
  return `github.com/${owner}/${repo}`;
}

/**
 * Tenant-safe Zoekt repository name. Includes orgId so two orgs indexing the same
 * GitHub repo do not collide on a shared Zoekt volume.
 */
export function zoektRepoName(orgId: string, repoId: string): string {
  const trimmedOrg = orgId.trim();
  if (!trimmedOrg) {
    return zoektHostRepoName(repoId);
  }
  return `${trimmedOrg}/${zoektHostRepoName(repoId)}`;
}

/** All names that might appear for a repo (org-prefixed + legacy host-only). */
export function zoektRepoNameCandidates(orgId: string, repoId: string): string[] {
  const prefixed = zoektRepoName(orgId, repoId);
  const legacy = zoektHostRepoName(repoId);
  return prefixed === legacy ? [prefixed] : [prefixed, legacy];
}
