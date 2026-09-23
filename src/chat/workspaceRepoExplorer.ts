import type { CodeHostProvider } from "../api/codeHosts/types";

export type WorkspaceRepoListItem = {
  repoId: string;
  owner: string;
  name: string;
  defaultBranch?: string;
};

/** Remote file picker rows. Only repos already returned as usable workspace repos. */
export function chatRepoListFromWorkspaceRepos(
  repos: WorkspaceRepoListItem[]
): Array<{
  provider: CodeHostProvider;
  owner: string;
  repo: string;
  branch?: string;
}> {
  return repos.map((entry) => {
    const providerToken = entry.repoId.includes(":") ? entry.repoId.split(":")[0] : "github";
    const provider: CodeHostProvider =
      providerToken === "gitlab" || providerToken === "bitbucket" ? providerToken : "github";
    const branch = entry.defaultBranch?.trim();
    return {
      provider,
      owner: entry.owner,
      repo: entry.name,
      ...(branch ? { branch } : {})
    };
  });
}
