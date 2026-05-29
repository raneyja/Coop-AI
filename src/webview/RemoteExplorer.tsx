import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { CodeHostProviderPreference, RemoteTreeNode, RepoContext } from "../chat/types";

type TreeState = {
  path: string;
  items: RemoteTreeNode[];
  error?: string;
  stale?: boolean;
  loading?: boolean;
  provider?: CodeHostProviderPreference;
};

type RemoteExplorerProps = {
  open: boolean;
  context: RepoContext;
  treeState: TreeState;
  onClose: () => void;
  onRefresh: (path: string) => void;
  onExpand: (path: string) => void;
  onSelectFile: (path: string) => void;
  onOpenSettings?: () => void;
};

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

function TreeRow({
  node,
  depth,
  selectedPath,
  onToggle,
  onOpenFile
}: {
  node: TreeNodeState;
  depth: number;
  selectedPath?: string;
  onToggle: (node: TreeNodeState) => void;
  onOpenFile: (path: string) => void;
}): React.ReactElement {
  const isDir = node.type === "dir";
  const isSelected = selectedPath === node.path;
  const paddingLeft = 8 + depth * 12;

  return (
    <>
      <li>
        <button
          type="button"
          className={`flex w-full items-center gap-1 rounded px-2 py-1 text-left hover:bg-[var(--vscode-list-hoverBackground)] ${
            isSelected ? "bg-[var(--vscode-list-activeSelectionBackground)]" : ""
          }`}
          style={{ paddingLeft }}
          onClick={() => (isDir ? onToggle(node) : onOpenFile(node.path))}
        >
          <span className="w-3 shrink-0 text-[10px] opacity-70">{isDir ? (node.expanded ? "▾" : "▸") : ""}</span>
          <span className="shrink-0">{isDir ? "📁" : "📄"}</span>
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {node.loading ? <span className="text-[10px] opacity-60">…</span> : null}
          {!isDir && node.size ? (
            <span className="shrink-0 text-[10px] text-[var(--vscode-descriptionForeground)]">
              {formatBytes(node.size)}
            </span>
          ) : null}
          {node.updatedAt ? (
            <span className="shrink-0 text-[10px] text-[var(--vscode-descriptionForeground)]">
              {formatRelativeTime(node.updatedAt)}
            </span>
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
  onClose,
  onRefresh,
  onExpand,
  onSelectFile,
  onOpenSettings
}: RemoteExplorerProps): React.ReactElement | null {
  const [nodes, setNodes] = useState<TreeNodeState[]>([]);

  const breadcrumb = useMemo(() => {
    const parts = [
      context.provider ? PROVIDER_LABEL[context.provider] : treeState.provider ? PROVIDER_LABEL[treeState.provider] : "Remote",
      context.owner && context.repo ? `${context.owner}/${context.repo}` : "repository",
      context.branch || "default branch",
      treeState.path && treeState.path !== "/" ? treeState.path : ""
    ].filter(Boolean);
    return parts.join(" · ");
  }, [context, treeState]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setNodes((current) => mergeTreeLevel(current, treeState.path || "", treeState.items, treeState.loading));
  }, [open, treeState.items, treeState.path, treeState.loading]);

  const handleToggle = useCallback(
    (node: TreeNodeState) => {
      if (node.type !== "dir") {
        return;
      }
      const willExpand = !node.expanded;
      setNodes((current) =>
        current.map((entry) =>
          entry.path === node.path
            ? { ...entry, expanded: willExpand, loading: willExpand && !entry.loaded }
            : entry
        )
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
    <div className="coop-canvas-bg mx-3 mb-2 flex max-h-56 min-h-0 shrink-0 flex-col overflow-hidden rounded-md border border-[var(--vscode-widget-border)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--vscode-widget-border)] px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-[var(--vscode-foreground)]">{breadcrumb}</div>
          {treeState.stale ? (
            <div className="text-[10px] text-[var(--vscode-editorWarning-foreground,var(--vscode-descriptionForeground))]">
              Showing cached data (host may be rate-limited).
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <button type="button" className="coop-text-btn" onClick={() => onRefresh(treeState.path || "")}>
            Refresh
          </button>
          <button type="button" className="coop-text-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto p-1 text-[11px]">
        {treeState.loading && nodes.length === 0 ? (
          <li className="px-2 py-2 text-[var(--vscode-descriptionForeground)]">Loading remote tree…</li>
        ) : null}
        {treeState.error ? (
          <li className="space-y-1 px-2 py-2 text-[var(--vscode-descriptionForeground)]">
            <div className="break-words">{treeState.error}</div>
            {authHint && onOpenSettings ? (
              <button type="button" className="coop-text-btn" onClick={onOpenSettings}>
                Open settings to add token
              </button>
            ) : null}
          </li>
        ) : nodes.length === 0 && !treeState.loading ? (
          <li className="px-2 py-2 text-[var(--vscode-descriptionForeground)]">No files in this directory.</li>
        ) : (
          nodes.map((node) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              selectedPath={context.file}
              onToggle={handleToggle}
              onOpenFile={onSelectFile}
            />
          ))
        )}
      </ul>
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
  return current.map((node) => {
    if (normalizeDir(node.path) !== normalizedParent) {
      return node;
    }
    return {
      ...node,
      loading: false,
      loaded: true,
      expanded: true,
      children: items.map((item) => toTreeNode(item, false))
    };
  });
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
