import type { WorkspaceRepo } from "@/lib/coopApi";
import {
  dedupeWorkspaceRepos,
  isWorkspaceRepoIndexReady,
  workspaceRepoLabel
} from "@/lib/workspaceRepoStatus";

type IndexedRepoStatusListProps = {
  repos: WorkspaceRepo[];
  loading?: boolean;
  emptyMessage?: string;
};

export function IndexedRepoStatusList({
  repos,
  loading,
  emptyMessage = "No repositories assigned yet."
}: IndexedRepoStatusListProps) {
  const unique = dedupeWorkspaceRepos(repos);

  if (loading) {
    return <p className="py-4 text-sm text-coop-muted">Loading…</p>;
  }

  if (unique.length === 0) {
    return <p className="py-4 text-sm text-coop-muted">{emptyMessage}</p>;
  }

  return (
    <div className="admin-list">
      {unique.map((repo) => {
        const ready = isWorkspaceRepoIndexReady(repo);
        return (
          <div key={repo.repoId} className="admin-list-row !justify-start gap-3">
            <span
              className={`admin-index-dot ${ready ? "admin-index-dot--ready" : "admin-index-dot--not-ready"}`}
              aria-hidden
            />
            <p className="font-mono text-sm text-white">{workspaceRepoLabel(repo)}</p>
            <span className="sr-only">{ready ? "Index ready" : "Index not ready"}</span>
          </div>
        );
      })}
    </div>
  );
}
