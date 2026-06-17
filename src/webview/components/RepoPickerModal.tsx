import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CoopPanelHeader } from "./CoopPanelHeader";
import {
  buildExplorerBreadcrumb,
  parseRepoNodePath,
  RemoteExplorerTreePanel,
  type ExplorerSearchState,
  type ExplorerTreeState
} from "./RemoteExplorerTree";
import type { CodeHostProviderPreference, GithubRepoOption, RepoContext } from "../../chat/types";

type RepoPickerModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  emptyHint?: string;
  disabledRepoIds?: Set<string>;
  repoMetadata?: GithubRepoOption[];
  treeState: ExplorerTreeState;
  searchState: ExplorerSearchState;
  browseContext: RepoContext;
  onClose: () => void;
  onSelect: (repo: GithubRepoOption) => void;
  onRefreshRepos: () => void;
  onBrowseRepos: () => void;
  onExpandPath: (path: string) => void;
  onOpenRepo: (payload: {
    provider: CodeHostProviderPreference;
    owner: string;
    repo: string;
    branch?: string;
  }) => void;
  onSearchFiles: (query: string) => void;
};

export function RepoPickerModal({
  open,
  title,
  subtitle,
  actionLabel = "Select",
  disabledRepoIds,
  repoMetadata,
  treeState,
  searchState,
  browseContext,
  onClose,
  onSelect,
  onRefreshRepos,
  onBrowseRepos,
  onExpandPath,
  onOpenRepo,
  onSearchFiles
}: RepoPickerModalProps): React.ReactElement | null {
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

  const breadcrumb = useMemo(
    () => buildExplorerBreadcrumb(browseContext, treeState),
    [browseContext, treeState]
  );

  const handleOpenRepo = useCallback(
    (path: string) => {
      const parsed = parseRepoNodePath(path);
      if (!parsed) {
        return;
      }
      onOpenRepo({
        provider: parsed.provider,
        owner: parsed.owner,
        repo: parsed.repo,
        branch: "main"
      });
    },
    [onOpenRepo]
  );

  if (!open) {
    return null;
  }

  const isRepoList = treeState.scope === "repos";

  return (
    <div className="coop-prompt-modal-stack coop-prompt-modal-stack--picker" role="presentation" onClick={onClose}>
      <div
        className="coop-prompt-modal coop-prompt-modal--picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repo-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <CoopPanelHeader
          variant="modal"
          wrapSubtitle
          titleElement="h2"
          titleId="repo-picker-title"
          title={title}
          subtitle={subtitle ? `${subtitle} · ${breadcrumb}` : breadcrumb}
          onClose={onClose}
          closeAriaLabel="Close"
          actions={
            <>
              {!isRepoList ? (
                <button type="button" className="coop-settings-action-btn" onClick={onBrowseRepos}>
                  Repos
                </button>
              ) : null}
              <button
                type="button"
                className="coop-settings-action-btn"
                onClick={() =>
                  isRepoList ? onRefreshRepos() : onExpandPath(treeState.path || "")
                }
              >
                Refresh
              </button>
            </>
          }
        />

        <div className="coop-prompt-modal-body coop-prompt-modal-body--explorer">
          <RemoteExplorerTreePanel
            treeState={treeState}
            searchState={searchState}
            context={browseContext}
            listClassName="coop-explorer-list coop-explorer-list--modal"
            pickerMode
            actionLabel={actionLabel}
            disabledRepoIds={disabledRepoIds}
            repoMetadata={repoMetadata}
            onRefreshRepos={onRefreshRepos}
            onRefreshPath={onExpandPath}
            onBrowseRepos={onBrowseRepos}
            onExpand={onExpandPath}
            onSearch={onSearchFiles}
            onOpenRepo={handleOpenRepo}
            onPickRepo={onSelect}
          />
        </div>
      </div>
    </div>
  );
}
