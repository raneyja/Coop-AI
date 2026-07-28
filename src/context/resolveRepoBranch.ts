import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { CodeHostProvider } from "../api/codeHosts/types";
import type { SecureApiClient } from "../chat/SecureApiClient";
import { resolveInventoryRepoIds } from "../workspace/repoInventorySources";
import type { RepoTarget } from "../workspace/indexedRepoWorkspaceTypes";

export type ResolveRepoBranchOptions = {
  codeHostRouter: CodeHostRouter;
  /** Branch recorded by Deep-Index (`repo_stats`) — wins over code-host defaults. */
  resolveIndexedBranch?: (repoId: string) => Promise<string | undefined>;
  /** Branch from workspace API / org catalog lookup. */
  resolveWorkspaceBranch?: (repoId: string) => Promise<string | undefined>;
};

/** Read the branch Deep-Index stored for this repo. Never guesses. */
export async function fetchIndexedBranch(
  api: SecureApiClient,
  apiBaseUrl: string,
  repoId: string,
  target: Pick<RepoTarget, "provider" | "owner" | "repo">
): Promise<string | undefined> {
  const resolved = resolveInventoryRepoIds(repoId, target);
  for (const candidate of resolved.candidates) {
    try {
      const stats = await api.fetchRepoInventoryViaCloud(apiBaseUrl, candidate);
      if (stats?.branch?.trim()) {
        return stats.branch.trim();
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Resolve the branch to use for indexed-repo reads.
 *
 * Priority: indexed branch → workspace/catalog → active UI context → tree probe.
 * Does not fall back to `"main"` or override indexed branch with code-host defaults.
 */
export async function resolveRepoBranchForTarget(
  target: RepoTarget,
  options: ResolveRepoBranchOptions
): Promise<string | undefined> {
  const owner = target.owner?.trim();
  const repo = target.repo?.trim();
  const repoId = target.repoId?.trim();
  if (!owner || !repo) {
    return target.branch?.trim() || undefined;
  }

  const provider: CodeHostProvider =
    target.provider === "gitlab" || target.provider === "bitbucket" ? target.provider : "github";

  let branch: string | undefined;

  if (repoId && options.resolveIndexedBranch) {
    branch = (await options.resolveIndexedBranch(repoId)) ?? undefined;
  }

  if (!branch && repoId && options.resolveWorkspaceBranch) {
    branch = (await options.resolveWorkspaceBranch(repoId)) ?? undefined;
  }

  if (!branch) {
    branch = target.branch?.trim() || undefined;
  }

  // Probe validates the branch is readable. Never replace an indexed/workspace
  // branch with whatever the tree response echoes (often the request branch or host default).
  const lockedBranch = Boolean(branch);
  try {
    const tree = await options.codeHostRouter.getRepositoryTree("", {
      provider,
      owner,
      repo,
      branch
    });
    if (!lockedBranch) {
      branch = tree.branch?.trim() || branch;
    }
  } catch {
    /* keep best-known branch */
  }

  return branch;
}
