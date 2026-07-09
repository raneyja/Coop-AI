import type { WorkspaceRepo } from "./coopApi";

export function isWorkspaceRepoIndexReady(repo: Pick<WorkspaceRepo, "indexStatus">): boolean {
  return repo.indexStatus === "ready";
}

/** One row per repoId — keeps member dashboard readable when grants repeat. */
export function dedupeWorkspaceRepos(repos: WorkspaceRepo[]): WorkspaceRepo[] {
  const seen = new Set<string>();
  const unique: WorkspaceRepo[] = [];
  for (const repo of repos) {
    if (seen.has(repo.repoId)) {
      continue;
    }
    seen.add(repo.repoId);
    unique.push(repo);
  }
  return unique;
}

export function workspaceRepoLabel(repo: Pick<WorkspaceRepo, "owner" | "name">): string {
  return `${repo.owner}/${repo.name}`;
}
