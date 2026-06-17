import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CoopPanelHeader } from "./CoopPanelHeader";
import type { GithubRepoOption } from "../../chat/types";

type WorkspaceReposPickerModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  repos: GithubRepoOption[];
  selectedRepoIds: string[];
  limit: number | null;
  loading: boolean;
  error?: string;
  saving?: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onSave: (repoIds: string[]) => void;
};

function indexStatusLabel(status?: string): string | undefined {
  if (!status || status === "ready") {
    return status === "ready" ? "Indexed" : undefined;
  }
  if (status === "indexing" || status === "queued" || status === "cloning") {
    return "Indexing…";
  }
  if (status === "error") {
    return "Index error";
  }
  return undefined;
}

export function WorkspaceReposPickerModal({
  open,
  title,
  subtitle,
  repos,
  selectedRepoIds,
  limit,
  loading,
  error,
  saving = false,
  onClose,
  onRefresh,
  onSave
}: WorkspaceReposPickerModalProps): React.ReactElement | null {
  const [draftSelected, setDraftSelected] = useState<string[]>(selectedRepoIds);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    setDraftSelected(selectedRepoIds);
  }, [open, selectedRepoIds]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const maxSelectable = limit ?? 0;
  const selectedCount = draftSelected.length;
  const canSelectMore = limit === null || selectedCount < maxSelectable;

  const filteredRepos = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return repos;
    }
    return repos.filter((repo) => {
      const label = `${repo.provider ? `${repo.provider}:` : ""}${repo.owner}/${repo.name}`.toLowerCase();
      return label.includes(needle);
    });
  }, [query, repos]);

  const toggleRepo = useCallback(
    (repoId: string) => {
      setDraftSelected((current) => {
        if (current.includes(repoId)) {
          return current.filter((id) => id !== repoId);
        }
        if (!canSelectMore) {
          return current;
        }
        return [...current, repoId];
      });
    },
    [canSelectMore]
  );

  const dirty =
    draftSelected.length !== selectedRepoIds.length ||
    draftSelected.some((repoId, index) => selectedRepoIds[index] !== repoId);

  if (!open) {
    return null;
  }

  const selectionLabel =
    limit != null ? `${selectedCount} / ${limit} selected` : `${selectedCount} selected`;

  return (
    <div className="coop-prompt-modal-stack coop-prompt-modal-stack--picker" role="presentation" onClick={onClose}>
      <div
        className="coop-prompt-modal coop-prompt-modal--picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-repos-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <CoopPanelHeader
          variant="modal"
          wrapSubtitle
          titleElement="h2"
          titleId="workspace-repos-picker-title"
          title={title}
          subtitle={subtitle}
          onClose={onClose}
          closeAriaLabel="Close"
          actions={
            <button type="button" className="coop-settings-action-btn" onClick={onRefresh} disabled={loading}>
              Refresh
            </button>
          }
        />

        <div className="coop-workspace-picker-meta">
          <span
            className={`coop-workspace-picker-count${
              limit != null && selectedCount >= limit ? " coop-workspace-picker-count--full" : ""
            }`}
          >
            {selectionLabel}
          </span>
          {limit != null && !canSelectMore ? (
            <span className="coop-prompt-modal-muted text-[11px]">Remove a repo to add another.</span>
          ) : null}
        </div>

        <div className="coop-prompt-modal-body coop-prompt-modal-body--explorer">
          <div className="coop-explorer-search-wrap">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter repositories…"
              className="coop-prompt-modal-search"
              aria-label="Filter repositories"
            />
          </div>

          <div className="coop-explorer-body">
            <div className="coop-settings-card !space-y-0 !p-0">
              <ul className="coop-explorer-list coop-explorer-list--modal no-scrollbar">
                {loading && filteredRepos.length === 0 ? (
                  <li className="coop-explorer-empty">Loading repositories…</li>
                ) : error ? (
                  <li className="coop-explorer-empty break-words">{error}</li>
                ) : filteredRepos.length === 0 ? (
                  <li className="coop-explorer-empty">
                    {query.trim()
                      ? "No repositories match your filter."
                      : "No indexed repositories yet. Ask your admin to finish org indexing."}
                  </li>
                ) : (
                  filteredRepos.map((repo) => {
                    const selected = draftSelected.includes(repo.repoId);
                    const disabled = !selected && !canSelectMore;
                    const status = indexStatusLabel(repo.indexStatus);
                    return (
                      <li key={repo.repoId}>
                        <button
                          type="button"
                          className={`coop-explorer-row coop-workspace-picker-row${
                            selected ? " coop-explorer-row--selected" : ""
                          }${disabled ? " coop-workspace-picker-row--disabled" : ""}`}
                          onClick={() => toggleRepo(repo.repoId)}
                          disabled={disabled}
                          aria-pressed={selected}
                        >
                          <span className="coop-workspace-picker-check" aria-hidden="true">
                            {selected ? "✓" : ""}
                          </span>
                          <span className="coop-explorer-row-name truncate">
                            {repo.provider ? `${repo.provider}:` : ""}
                            {repo.owner}/{repo.name}
                          </span>
                          {status ? <span className="coop-explorer-row-meta">{status}</span> : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </div>
        </div>

        <div className="coop-prompt-modal-footer coop-prompt-modal-footer--inset">
          <button type="button" className="coop-settings-action-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="coop-settings-action-btn coop-settings-action-btn--primary"
            disabled={!dirty || saving || selectedCount === 0}
            onClick={() => onSave(draftSelected)}
          >
            {saving ? "Saving…" : "Save workspace repos"}
          </button>
        </div>
      </div>
    </div>
  );
}
