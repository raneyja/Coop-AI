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
import { parentExplorerPath } from "../lib/explorerPaths";

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

  const [browsePath, setBrowsePath] = useState<string | null>(null);

  const breadcrumb = useMemo(
    () => buildExplorerBreadcrumb(browseContext, treeState),
    [browseContext, treeState]
  );

  const isRepoList = treeState.scope === "repos";

  useEffect(() => {
    if (!open || isRepoList) {
      setBrowsePath(null);
    }
  }, [open, isRepoList]);

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

  const handleNavigateToPath = useCallback(
    (path: string) => {
      setBrowsePath(path);
      onExpandPath(path);
    },
    [onExpandPath]
  );

  const handleBrowseUp = useCallback(() => {
    if (browsePath === null) {
      return;
    }
    const parent = parentExplorerPath(browsePath);
    if (!parent) {
      setBrowsePath(null);
      onExpandPath("");
      return;
    }
    setBrowsePath(parent);
    onExpandPath(parent);
  }, [browsePath, onExpandPath]);

  const handleBrowseRepos = useCallback(() => {
    setBrowsePath(null);
    onBrowseRepos();
  }, [onBrowseRepos]);

  if (!open) {
    return null;
  }

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
          onBack={browsePath ? handleBrowseUp : undefined}
          actions={
            <>
              {!isRepoList ? (
                <button type="button" className="coop-settings-action-btn" onClick={handleBrowseRepos}>
                  Repos
                </button>
              ) : null}
              <button
                type="button"
                className="coop-settings-action-btn"
                onClick={() =>
                  isRepoList
                    ? onRefreshRepos()
                    : onExpandPath(browsePath ?? (treeState.path || ""))
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
            browsePath={browsePath}
            onNavigateToPath={handleNavigateToPath}
            onRefreshRepos={onRefreshRepos}
            onRefreshPath={onExpandPath}
            onBrowseRepos={handleBrowseRepos}
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
