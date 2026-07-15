import React, { useEffect, useMemo } from "react";
import type { SettingsScreen } from "../chat/settingsScreens";
import { CoopPanelHeader } from "./components/CoopPanelHeader";
import { RefreshButton } from "./components/RefreshButton";
import {
  buildExplorerBreadcrumb,
  parseRepoNodePath,
  RemoteExplorerTreePanel,
  type ExplorerSearchState,
  type ExplorerTreeState
} from "./components/RemoteExplorerTree";
import type { RepoContext } from "../chat/types";

export { parseRepoNodePath } from "./components/RemoteExplorerTree";

type RemoteExplorerProps = {
  open: boolean;
  context: RepoContext;
  treeState: ExplorerTreeState;
  searchState: ExplorerSearchState;
  className?: string;
  onClose: () => void;
  onRefresh: (path: string) => void;
  onRefreshRepos: () => void;
  onBrowseRepos: () => void;
  onExpand: (path: string) => void;
  onSearch: (query: string) => void;
  onSelectFile: (path: string) => void;
  onBrowseRepo: (path: string) => void;
  onUseRepo: (path: string) => void;
  onOpenSettings?: (screen?: SettingsScreen) => void;
  onOpenAdminPortal?: () => void;
};

export function RemoteExplorer({
  open,
  context,
  treeState,
  searchState,
  className = "",
  onClose,
  onRefresh,
  onRefreshRepos,
  onBrowseRepos,
  onExpand,
  onSearch,
  onSelectFile,
  onBrowseRepo,
  onUseRepo,
  onOpenSettings,
  onOpenAdminPortal
}: RemoteExplorerProps): React.ReactElement | null {
  const isRepoList = treeState.scope === "repos";

  const breadcrumb = useMemo(
    () => buildExplorerBreadcrumb(context, treeState),
    [context, treeState]
  );

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

  if (!open) {
    return null;
  }

  return (
    <div className={`coop-explorer-shell ${className}`}>
      <CoopPanelHeader
        title="Remote workspace"
        subtitle={breadcrumb}
        onClose={onClose}
        closeAriaLabel="Close explorer"
        actions={
          <>
            {!isRepoList ? (
              <button type="button" className="coop-settings-action-btn" onClick={onBrowseRepos}>
                Repos
              </button>
            ) : null}
            <RefreshButton onClick={() => (isRepoList ? onRefreshRepos() : onRefresh(treeState.path || ""))} />
          </>
        }
      />
      <RemoteExplorerTreePanel
        treeState={treeState}
        searchState={searchState}
        context={context}
        repoBrowseMode
        onRefreshRepos={onRefreshRepos}
        onRefreshPath={onRefresh}
        onBrowseRepos={onBrowseRepos}
        onExpand={onExpand}
        onSearch={onSearch}
        onOpenRepo={onBrowseRepo}
        onOpenFile={(path) => {
          onSelectFile(path);
          onClose();
        }}
        onUseRepo={onUseRepo}
        onOpenSettings={onOpenSettings}
        onOpenAdminPortal={onOpenAdminPortal}
      />
    </div>
  );
}

export function repoSelectPayloadFromNodePath(path: string):
  | { provider: import("../chat/types").CodeHostProviderPreference; owner: string; repo: string }
  | undefined {
  return parseRepoNodePath(path);
}
