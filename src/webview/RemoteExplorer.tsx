import React, { useEffect, useMemo, useRef } from "react";
import { settingsScreenForProvider } from "../chat/settingsScreens";
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
import type { CodeHostProviderPreference, RepoContext } from "../chat/types";

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
  onSelectRepo: (path: string) => void;
  onOpenSettings?: (screen?: SettingsScreen) => void;
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
  onSelectRepo,
  onOpenSettings
}: RemoteExplorerProps): React.ReactElement | null {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isRepoList = treeState.scope === "repos";

  const breadcrumb = useMemo(
    () => buildExplorerBreadcrumb(context, treeState),
    [context, treeState]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

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
        onRefreshRepos={onRefreshRepos}
        onRefreshPath={onRefresh}
        onBrowseRepos={onBrowseRepos}
        onExpand={onExpand}
        onSearch={onSearch}
        onOpenRepo={onSelectRepo}
        onOpenFile={(path) => {
          onSelectFile(path);
          onClose();
        }}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}
