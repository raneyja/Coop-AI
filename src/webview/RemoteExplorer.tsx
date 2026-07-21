import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  clampExplorerListHeight,
  EXPLORER_LIST_HEIGHT_MIN,
  maxExplorerListHeight,
  parentExplorerPath,
  readStoredExplorerListHeight,
  storeExplorerListHeight
} from "./lib/explorerPaths";

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
  const [browsePath, setBrowsePath] = useState<string | null>(null);
  const [listHeight, setListHeight] = useState(readStoredExplorerListHeight);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const breadcrumb = useMemo(
    () => buildExplorerBreadcrumb(context, treeState),
    [context, treeState]
  );

  useEffect(() => {
    if (!open || isRepoList) {
      setBrowsePath(null);
    }
  }, [open, isRepoList]);

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

  const handleNavigateToPath = useCallback(
    (path: string) => {
      setBrowsePath(path);
      onExpand(path);
    },
    [onExpand]
  );

  const handleBrowseUp = useCallback(() => {
    if (browsePath === null) {
      return;
    }
    const parent = parentExplorerPath(browsePath);
    if (!parent) {
      setBrowsePath(null);
      onExpand("");
      return;
    }
    setBrowsePath(parent);
    onExpand(parent);
  }, [browsePath, onExpand]);

  const handleBrowseRepos = useCallback(() => {
    setBrowsePath(null);
    onBrowseRepos();
  }, [onBrowseRepos]);

  const handleRefresh = useCallback(() => {
    if (isRepoList) {
      onRefreshRepos();
      return;
    }
    onRefresh(browsePath ?? (treeState.path || ""));
  }, [browsePath, isRepoList, onRefresh, onRefreshRepos, treeState.path]);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      dragRef.current = { startY: event.clientY, startHeight: listHeight };

      const onMove = (moveEvent: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) {
          return;
        }
        // Overlay grows upward from the composer — drag up increases height.
        const next = clampExplorerListHeight(
          drag.startHeight + (drag.startY - moveEvent.clientY),
          EXPLORER_LIST_HEIGHT_MIN,
          maxExplorerListHeight()
        );
        setListHeight(next);
      };

      const onUp = (upEvent: PointerEvent) => {
        dragRef.current = null;
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        setListHeight((current) => {
          const clamped = clampExplorerListHeight(
            current,
            EXPLORER_LIST_HEIGHT_MIN,
            maxExplorerListHeight()
          );
          storeExplorerListHeight(clamped);
          return clamped;
        });
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [listHeight]
  );

  if (!open) {
    return null;
  }

  return (
    <div className={`coop-explorer-shell ${className}`}>
      <div
        className="coop-explorer-resize-handle"
        role="separator"
        tabIndex={0}
        aria-orientation="horizontal"
        aria-label="Resize remote workspace"
        aria-valuemin={EXPLORER_LIST_HEIGHT_MIN}
        aria-valuemax={maxExplorerListHeight()}
        aria-valuenow={listHeight}
        title="Drag to resize"
        onPointerDown={handleResizePointerDown}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
            return;
          }
          event.preventDefault();
          const delta = event.key === "ArrowUp" ? 24 : -24;
          setListHeight((current) => {
            const next = clampExplorerListHeight(
              current + delta,
              EXPLORER_LIST_HEIGHT_MIN,
              maxExplorerListHeight()
            );
            storeExplorerListHeight(next);
            return next;
          });
        }}
      />
      <CoopPanelHeader
        title="Remote workspace"
        subtitle={breadcrumb}
        onClose={onClose}
        closeAriaLabel="Close explorer"
        onBack={browsePath ? handleBrowseUp : undefined}
        actions={
          <>
            {!isRepoList ? (
              <button type="button" className="coop-settings-action-btn" onClick={handleBrowseRepos}>
                Repos
              </button>
            ) : null}
            <RefreshButton onClick={handleRefresh} />
          </>
        }
      />
      <RemoteExplorerTreePanel
        treeState={treeState}
        searchState={searchState}
        context={context}
        repoBrowseMode
        browsePath={browsePath}
        onNavigateToPath={handleNavigateToPath}
        listMaxHeightPx={listHeight}
        onRefreshRepos={onRefreshRepos}
        onRefreshPath={onRefresh}
        onBrowseRepos={handleBrowseRepos}
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
