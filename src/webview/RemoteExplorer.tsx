import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshButton } from "./components/RefreshButton";
import type { CodeHostProviderPreference, RemoteTreeNode, RepoContext } from "../chat/types";

type TreeState = {
  path: string;
  items: RemoteTreeNode[];
  scope?: "repos" | "files";
  error?: string;
  stale?: boolean;
  loading?: boolean;
  provider?: CodeHostProviderPreference;
};

type RemoteExplorerProps = {
  open: boolean;
  context: RepoContext;
  treeState: TreeState;
  className?: string;
  onClose: () => void;
  onRefresh: (path: string) => void;
  onRefreshRepos: () => void;
  onBrowseRepos: () => void;
  onExpand: (path: string) => void;
  onSelectFile: (path: string) => void;
  onSelectRepo: (path: string) => void;
  onOpenSettings?: () => void;
};

export function parseRepoNodePath(
  path: string
): { provider: CodeHostProviderPreference; owner: string; repo: string } | undefined {
  const match = /^(github|gitlab|bitbucket):([^/]+)\/(.+)$/.exec(path.trim());
  if (!match) {
    return undefined;
  }
  return {
    provider: match[1] as CodeHostProviderPreference,
    owner: match[2],
    repo: match[3]
  };
}

type TreeNodeState = RemoteTreeNode & {
  children?: RemoteTreeNode[];
  loading?: boolean;
  expanded?: boolean;
  loaded?: boolean;
};

const PROVIDER_LABEL: Record<CodeHostProviderPreference, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket"
};

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(iso?: string): string | undefined {
  if (!iso) {
    return undefined;
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return undefined;
  }
  const diffMs = Date.now() - then;
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days > 0) {
    return `${days}d ago`;
  }
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours > 0) {
    return `${hours}h ago`;
  }
  return "recent";
}

function ChevronIcon({ expanded }: { expanded: boolean }): React.ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {expanded ? (
        <path d="M3.5 6.5L8 11l4.5-4.5H3.5z" />
      ) : (
        <path d="M6.5 3.5L11 8l-4.5 4.5V3.5z" />
      )}
    </svg>
  );
}

function FolderIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7h5l2 2h11v8H3V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function RepoIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16v10H4V7zM4 7l2-3h12l2 3M9 12h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TreeRow({
  node,
  depth,
  selectedPath,
  onToggle,
  onOpenFile,
  onOpenRepo
}: {
  node: TreeNodeState;
  depth: number;
  selectedPath?: string;
  onToggle: (node: TreeNodeState) => void;
  onOpenFile: (path: string) => void;
  onOpenRepo: (path: string) => void;
}): React.ReactElement {
  const isRepo = node.type === "repo";
  const isDir = node.type === "dir";
  const isSelected = !isRepo && selectedPath === node.path;
  const paddingLeft = 6 + depth * 14;

  return (
    <>
      <li>
        <button
          type="button"
          className={`coop-explorer-row${isSelected ? " coop-explorer-row--selected" : ""}`}
          style={{ paddingLeft }}
          onClick={() => {
            if (isRepo) {
              onOpenRepo(node.path);
            } else if (isDir) {
              onToggle(node);
            } else {
              onOpenFile(node.path);
            }
          }}
        >
          <span className="coop-explorer-row-chevron">{isDir ? <ChevronIcon expanded={!!node.expanded} /> : null}</span>
          <span className="coop-explorer-row-icon">{isRepo ? <RepoIcon /> : isDir ? <FolderIcon /> : <FileIcon />}</span>
          <span className="coop-explorer-row-name">{node.name}</span>
          {node.loading ? <span className="coop-explorer-row-meta">…</span> : null}
          {!isDir && node.size ? <span className="coop-explorer-row-meta">{formatBytes(node.size)}</span> : null}
          {node.updatedAt ? (
            <span className="coop-explorer-row-meta">{formatRelativeTime(node.updatedAt)}</span>
          ) : null}
        </button>
      </li>
      {isDir && node.expanded
        ? (node.children ?? []).map((child) => (
            <TreeRow
              key={child.path}
              node={child as TreeNodeState}
              depth={depth + 1}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onOpenRepo={onOpenRepo}
            />
          ))
        : null}
    </>
  );
}

export function RemoteExplorer({
  open,
  context,
  treeState,
  className = "",
  onClose,
  onRefresh,
  onRefreshRepos,
  onBrowseRepos,
  onExpand,
  onSelectFile,
  onSelectRepo,
  onOpenSettings
}: RemoteExplorerProps): React.ReactElement | null {
  const [nodes, setNodes] = useState<TreeNodeState[]>([]);
  const isRepoList = treeState.scope === "repos";

  const breadcrumb = useMemo(() => {
    if (isRepoList) {
      const provider =
        context.provider ?? treeState.provider
          ? PROVIDER_LABEL[context.provider ?? treeState.provider ?? "github"]
          : "Remote";
      return `${provider} · Repositories`;
    }
    const parts = [
      context.provider ? PROVIDER_LABEL[context.provider] : treeState.provider ? PROVIDER_LABEL[treeState.provider] : "Remote",
      context.owner && context.repo ? `${context.owner}/${context.repo}` : "repository",
      context.branch || "default branch",
      treeState.path && treeState.path !== "/" ? treeState.path : ""
    ].filter(Boolean);
    return parts.join(" · ");
  }, [context, isRepoList, treeState]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (isRepoList) {
      setNodes(treeState.items.map((item) => toTreeNode(item, treeState.loading)));
      return;
    }
    setNodes((current) => mergeTreeLevel(current, treeState.path || "", treeState.items, treeState.loading));
  }, [open, isRepoList, treeState.items, treeState.path, treeState.loading]);

  const handleToggle = useCallback(
    (node: TreeNodeState) => {
      if (node.type !== "dir") {
        return;
      }
      const willExpand = !node.expanded;
      setNodes((current) =>
        updateTreeNodes(current, node.path, (entry) => ({
          ...entry,
          expanded: willExpand,
          loading: willExpand && !entry.loaded
        }))
      );
      if (willExpand && !node.loaded) {
        onExpand(node.path);
      }
    },
    [onExpand]
  );

  if (!open) {
    return null;
  }

  const authHint = treeState.error?.toLowerCase().includes("token") || treeState.error?.toLowerCase().includes("auth");

  return (
    <div className={`coop-explorer-shell ${className}`}>
      <header className="coop-settings-header">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-[var(--coop-panel-foreground)]">Remote workspace</h2>
          <p className="coop-settings-card-desc truncate">{breadcrumb}</p>
          {treeState.stale ? (
            <p className="mt-0.5 text-[10px] text-[var(--vscode-editorWarning-foreground,var(--coop-panel-muted))]">
              Showing cached data (host may be rate-limited).
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isRepoList ? (
            <button type="button" className="coop-settings-action-btn" onClick={onBrowseRepos}>
              Repos
            </button>
          ) : null}
          <RefreshButton onClick={() => (isRepoList ? onRefreshRepos() : onRefresh(treeState.path || ""))} />
          <button type="button" className="coop-icon-btn shrink-0" onClick={onClose} aria-label="Close explorer" title="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 6.586L3.414 2 2 3.414 6.586 8 2 12.586 3.414 14 8 9.414 12.586 14 14 12.586 9.414 8 14 3.414 12.586 2 8 6.586z" />
            </svg>
          </button>
        </div>
      </header>

      <div className="coop-explorer-body">
        <div className="coop-settings-card !space-y-0 !p-0">
          <ul className="coop-explorer-list no-scrollbar">
            {treeState.loading && nodes.length === 0 ? (
              <li className="coop-explorer-empty">
                {isRepoList ? "Loading repositories…" : "Loading remote tree…"}
              </li>
            ) : null}
            {treeState.error ? (
              <li className="coop-explorer-empty space-y-2">
                <div className="break-words">{treeState.error}</div>
                {authHint && onOpenSettings ? (
                  <button type="button" className="coop-settings-action-btn" onClick={onOpenSettings}>
                    Open settings to add token
                  </button>
                ) : null}
              </li>
            ) : nodes.length === 0 && !treeState.loading ? (
              <li className="coop-explorer-empty">
                {isRepoList
                  ? "No repositories found. Pin repos in settings or add a GitHub token."
                  : "No files in this directory."}
              </li>
            ) : (
              nodes.map((node) => (
                <TreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedPath={context.file}
                  onToggle={handleToggle}
                  onOpenRepo={(path) => {
                    onSelectRepo(path);
                  }}
                  onOpenFile={(path) => {
                    onSelectFile(path);
                    onClose();
                  }}
                />
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function mergeTreeLevel(
  current: TreeNodeState[],
  parentPath: string,
  items: RemoteTreeNode[],
  loading?: boolean
): TreeNodeState[] {
  const normalizedParent = normalizeDir(parentPath);
  if (!normalizedParent) {
    return items.map((item) => toTreeNode(item, loading));
  }
  return updateTreeNodes(current, normalizedParent, (node) => ({
    ...node,
    loading: false,
    loaded: true,
    expanded: true,
    children: items.map((item) => toTreeNode(item, false))
  }));
}

function updateTreeNodes(
  nodes: TreeNodeState[],
  targetPath: string,
  updater: (node: TreeNodeState) => TreeNodeState
): TreeNodeState[] {
  const normalized = normalizeDir(targetPath);
  let changed = false;
  const next = nodes.map((node) => {
    if (normalizeDir(node.path) === normalized) {
      changed = true;
      return updater(node);
    }
    if (node.children?.length) {
      const children = updateTreeNodes(node.children as TreeNodeState[], targetPath, updater);
      if (children !== node.children) {
        changed = true;
        return { ...node, children };
      }
    }
    return node;
  });
  return changed ? next : nodes;
}

function toTreeNode(item: RemoteTreeNode, loading?: boolean): TreeNodeState {
  return {
    ...item,
    expanded: false,
    loaded: false,
    loading: item.type === "dir" ? loading : false,
    children: item.type === "dir" ? [] : undefined
  };
}

function normalizeDir(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}
