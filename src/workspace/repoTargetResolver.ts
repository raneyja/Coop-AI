import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { SecureApiClient } from "../chat/SecureApiClient";
import { fetchIndexedBranch, resolveRepoBranchForTarget } from "../context/resolveRepoBranch";
import type { RepoTarget } from "./indexedRepoWorkspaceTypes";
import { resolveInventoryRepoIds } from "./repoInventorySources";

export type ResolveActiveRepoTargetOptions = {
  api: SecureApiClient;
  apiBaseUrl: string;
  codeHostRouter: CodeHostRouter;
  resolveWorkspaceBranch?: (repoId: string) => Promise<string | undefined>;
};

/**
 * Canonical repo coordinates for every indexed-repo consumer (chat, quick actions,
 * repo summary, agent tools). Reads the branch Deep-Index recorded first — the same
 * record written by INDEX_REPOSITORY in `executors.ts`.
 */
export async function resolveActiveRepoTarget(
  target: RepoTarget,
  options: ResolveActiveRepoTargetOptions
): Promise<RepoTarget> {
  const repoId = target.repoId?.trim();
  if (!repoId) {
    return target;
  }

  const normalized = resolveInventoryRepoIds(repoId, target);
  const branch = await resolveRepoBranchForTarget(
    { ...target, repoId: normalized.preferred },
    {
      codeHostRouter: options.codeHostRouter,
      resolveIndexedBranch: (id) => fetchIndexedBranch(options.api, options.apiBaseUrl, id, target),
      resolveWorkspaceBranch: options.resolveWorkspaceBranch
    }
  );

  return {
    ...target,
    repoId: normalized.preferred,
    owner: normalized.coords?.owner ?? target.owner,
    repo: normalized.coords?.repo ?? target.repo,
    provider: normalized.coords?.provider ?? target.provider,
    branch
  };
}
