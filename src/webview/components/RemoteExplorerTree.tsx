import React, { useCallback, useEffect, useMemo, useState } from "react";
import { settingsScreenForProvider } from "../../chat/settingsScreens";
import type { SettingsScreen } from "../../chat/settingsScreens";
import type { CodeHostProviderPreference, GithubRepoOption, RemoteTreeNode, RepoContext } from "../../chat/types";

export type ExplorerTreeState = {
  path: string;
  items: RemoteTreeNode[];
  scope?: "repos" | "files";
  error?: string;
  stale?: boolean;
  loading?: boolean;
  provider?: CodeHostProviderPreference;
  /** When set, empty repo list shows workspace picker guidance instead of connect GitHub copy. */
  emptyHint?: "workspace";
  /** Adjusts breadcrumb when listing workspace-selected repos only. */
  listLabel?: "workspace";
};

export type ExplorerSearchState = {
  query: string;
  items: RemoteTreeNode[];
  error?: string;
  loading?: boolean;
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

export function repoOptionFromPath(path: string, metadata?: GithubRepoOption[]): GithubRepoOption | undefined {
  const parsed = parseRepoNodePath(path);
  if (!parsed) {
    return undefined;
  }
  const repoId = `${parsed.provider}:${parsed.owner}/${parsed.repo}`;
  const meta = metadata?.find((entry) => entry.repoId === repoId);
  return (
    meta ?? {
      repoId,
      owner: parsed.owner,
      name: parsed.repo,
      defaultBranch: "main"
    }
  );
}

type TreeNodeState = RemoteTreeNode & {
  children?: RemoteTreeNode[];
  loading?: boolean;
  expanded?: boolean;
  loaded?: boolean;
};

type SelectedRepoContext = {
  provider?: CodeHostProviderPreference;
  owner: string;
  repo: string;
};

const PROVIDER_LABEL: Record<CodeHostProviderPreference, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket"
};

const SEARCH_DEBOUNCE_MS = 300;

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

function SearchResultRow({
  node,
  selectedPath,
  onOpenFile
}: {
  node: TreeNodeState;
  selectedPath?: string;
  onOpenFile: (path: string) => void;
}): React.ReactElement {
  const isSelected = selectedPath === node.path;
  const directory = node.path.includes("/") ? node.path.slice(0, node.path.lastIndexOf("/")) : "";

  return (
    <li>
      <button
        type="button"
        className={`coop-explorer-row${isSelected ? " coop-explorer-row--selected" : ""}`}
        onClick={() => onOpenFile(node.path)}
      >
        <span className="coop-explorer-row-chevron" />
        <span className="coop-explorer-row-icon">
          <FileIcon />
        </span>
        <span className="coop-explorer-row-name">{node.name}</span>
        {directory ? <span className="coop-explorer-row-meta">{directory}</span> : null}
      </button>
    </li>
  );
}

function TreeRow({
  node,
  depth,
  selectedPath,
  selectedRepo,
  pickerMode,
  repoBrowseMode,
  actionLabel,
  disabled,
  onToggle,
  onOpenFile,
  onOpenRepo,
  onPickRepo,
  onUseRepo
}: {
  node: TreeNodeState;
  depth: number;
  selectedPath?: string;
  selectedRepo?: SelectedRepoContext;
  pickerMode?: boolean;
  repoBrowseMode?: boolean;
  actionLabel?: string;
  disabled?: boolean;
  onToggle: (node: TreeNodeState) => void;
  onOpenFile: (path: string) => void;
  onOpenRepo: (path: string) => void;
  onPickRepo?: (path: string) => void;
  onUseRepo?: (path: string) => void;
}): React.ReactElement {
  const isRepo = node.type === "repo";
  const isDir = node.type === "dir";
  const isSelected = isRepo
    ? repoPathMatchesContext(node.path, selectedRepo)
    : selectedPath === node.path;
  const paddingLeft = 6 + depth * 14;
  const showUseRepoAction = repoBrowseMode && isRepo && onUseRepo;
  const isActiveRepo = isRepo && isSelected;

  return (
    <>
      <li>
        <div className={`coop-explorer-row${isSelected ? " coop-explorer-row--selected" : ""}`} style={{ paddingLeft }}>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            disabled={pickerMode && isRepo && disabled}
            onClick={() => {
              if (isRepo) {
                if (pickerMode && onPickRepo) {
                  if (!disabled) {
                    onPickRepo(node.path);
                  }
                } else {
                  onOpenRepo(node.path);
                }
              } else if (isDir) {
                onToggle(node);
              } else {
                onOpenFile(node.path);
              }
            }}
          >
            <span className="coop-explorer-row-chevron">
              {isDir ? <ChevronIcon expanded={!!node.expanded} /> : isRepo && repoBrowseMode ? <ChevronIcon expanded={false} /> : null}
            </span>
            <span className="coop-explorer-row-icon">
              {isRepo ? <RepoIcon /> : isDir ? <FolderIcon /> : <FileIcon />}
            </span>
            <span className="coop-explorer-row-name truncate">{node.name}</span>
            {node.loading ? <span className="coop-explorer-row-meta">…</span> : null}
            {!isDir && node.size ? <span className="coop-explorer-row-meta">{formatBytes(node.size)}</span> : null}
            {node.updatedAt ? (
              <span className="coop-explorer-row-meta">{formatRelativeTime(node.updatedAt)}</span>
            ) : null}
          </button>
          {pickerMode && isRepo && onPickRepo ? (
            <button
              type="button"
              className="coop-settings-action-btn shrink-0"
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                onPickRepo(node.path);
              }}
            >
              {disabled ? "Added" : actionLabel ?? "Select"}
            </button>
          ) : null}
          {showUseRepoAction ? (
            <button
              type="button"
              className={`coop-settings-action-btn shrink-0${isActiveRepo ? " coop-settings-action-btn--primary" : ""}`}
              aria-label={`Use ${node.name} as chat context`}
              title="Set this repository as active context without picking a file"
              onClick={(event) => {
                event.stopPropagation();
                onUseRepo(node.path);
              }}
            >
              {isActiveRepo ? "In use" : "Use repo"}
            </button>
          ) : null}
        </div>
      </li>
      {isDir && node.expanded
        ? (node.children ?? []).map((child) => (
            <TreeRow
              key={child.path}
              node={child as TreeNodeState}
              depth={depth + 1}
              selectedPath={selectedPath}
              selectedRepo={selectedRepo}
              pickerMode={pickerMode}
              repoBrowseMode={repoBrowseMode}
              actionLabel={actionLabel}
              disabled={disabled}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
              onOpenRepo={onOpenRepo}
              onPickRepo={onPickRepo}
              onUseRepo={onUseRepo}
            />
          ))
        : null}
    </>
  );
}

type RemoteExplorerTreePanelProps = {
  treeState: ExplorerTreeState;
  searchState: ExplorerSearchState;
  context: RepoContext;
  listClassName?: string;
  pickerMode?: boolean;
  /** Chat explorer: row opens file tree; separate Use repo action sets context. */
  repoBrowseMode?: boolean;
  actionLabel?: string;
  disabledRepoIds?: Set<string>;
  repoMetadata?: GithubRepoOption[];
  searchPlaceholder?: string;
  onRefreshRepos: () => void;
  onRefreshPath: (path: string) => void;
  onBrowseRepos: () => void;
  onExpand: (path: string) => void;
  onSearch: (query: string) => void;
  onOpenRepo: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onPickRepo?: (repo: GithubRepoOption) => void;
  onUseRepo?: (path: string) => void;
  onOpenSettings?: (screen?: SettingsScreen) => void;
};

export function RemoteExplorerTreePanel({
  treeState,
  searchState,
  context,
  listClassName = "coop-explorer-list",
  pickerMode = false,
  repoBrowseMode = false,
  actionLabel,
  disabledRepoIds,
  repoMetadata,
  searchPlaceholder,
  onRefreshRepos,
  onRefreshPath,
  onBrowseRepos,
  onExpand,
  onSearch,
  onOpenRepo,
  onOpenFile,
  onPickRepo,
  onUseRepo,
  onOpenSettings
}: RemoteExplorerTreePanelProps): React.ReactElement {
  const [nodes, setNodes] = useState<TreeNodeState[]>([]);
  const [query, setQuery] = useState("");
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const isRepoList = treeState.scope === "repos";
  const trimmedQuery = query.trim();
  const isFileSearch = !isRepoList && trimmedQuery.length > 0;
  const searchResultsStale = isFileSearch && searchState.query !== trimmedQuery;

  useEffect(() => {
    setQuery("");
  }, [isRepoList]);

  useEffect(() => {
    if (isRepoList) {
      setNodes(treeState.items.map((item) => toTreeNode(item, treeState.loading)));
      return;
    }
    setNodes((current) => mergeTreeLevel(current, treeState.path || "", treeState.items, treeState.loading));
  }, [isRepoList, treeState.items, treeState.path, treeState.loading]);

  useEffect(() => {
    if (isRepoList) {
      return;
    }
    if (!trimmedQuery) {
      onSearch("");
      return;
    }
    const timer = window.setTimeout(() => {
      onSearch(trimmedQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [isRepoList, trimmedQuery, onSearch]);

  const filteredNodes = useMemo(() => {
    if (!isRepoList || !trimmedQuery) {
      return nodes;
    }
    const needle = trimmedQuery.toLowerCase();
    return nodes.filter((node) => node.name.toLowerCase().includes(needle));
  }, [isRepoList, nodes, trimmedQuery]);

  const localSearchMatches = useMemo(() => {
    if (!isFileSearch) {
      return [];
    }
    const needle = trimmedQuery.toLowerCase();
    return flattenLoadedTree(nodes).filter(
      (node) =>
        node.type !== "repo" &&
        (node.path.toLowerCase().includes(needle) || node.name.toLowerCase().includes(needle))
    );
  }, [isFileSearch, nodes, trimmedQuery]);

  const fileSearchNodes = useMemo(() => {
    if (!isFileSearch) {
      return [];
    }
    if (!searchResultsStale && !searchState.loading && searchState.items.length > 0) {
      return searchState.items.map((item) => toTreeNode(item, false));
    }
    return localSearchMatches;
  }, [isFileSearch, localSearchMatches, searchResultsStale, searchState.items, searchState.loading]);

  const awaitingRemoteSearch =
    isFileSearch && (searchResultsStale || searchState.loading) && fileSearchNodes.length === 0;

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

  const authHint = treeState.error?.toLowerCase().includes("token") || treeState.error?.toLowerCase().includes("auth");
  const searchError = searchState.error?.toLowerCase() ?? "";
  const searchSettingsHint =
    Boolean(searchState.error) &&
    !searchError.includes("403") &&
    !searchError.includes("422") &&
    !searchError.includes("code search") &&
    (searchError.includes("not installed") ||
      searchError.includes("not connected") ||
      searchError.includes("token is missing") ||
      searchError.includes("authentication failed") ||
      searchError.includes("authorize"));

  const handlePickRepo = useCallback(
    (path: string) => {
      const repo = repoOptionFromPath(path, repoMetadata);
      if (repo) {
        onPickRepo?.(repo);
      }
    },
    [onPickRepo, repoMetadata]
  );

  const selectedRepo = useMemo<SelectedRepoContext | undefined>(() => {
    if (!context.owner || !context.repo) {
      return undefined;
    }
    return {
      owner: context.owner,
      repo: context.repo,
      provider: context.provider
    };
  }, [context.owner, context.provider, context.repo]);

  return (
    <>
      {treeState.stale ? (
        <p className="coop-panel-header-subtitle px-3 pb-2 text-[10px] text-[var(--vscode-editorWarning-foreground,var(--coop-panel-muted))]">
          Showing cached data (host may be rate-limited).
        </p>
      ) : null}

      <div className="coop-explorer-search-wrap">
        <input
          ref={searchInputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            searchPlaceholder ?? (isRepoList ? "Filter repositories…" : "Search files…")
          }
          className="coop-prompt-modal-search"
          aria-label={isRepoList ? "Filter repositories" : "Search files"}
        />
        {!isRepoList && !isFileSearch ? (
          <p className="coop-explorer-search-hint">Type to search indexed files, or browse folders below.</p>
        ) : null}
      </div>

      <div className="coop-explorer-body">
        <div className="coop-settings-card !space-y-0 !p-0">
          <ul className={`${listClassName} no-scrollbar`}>
            {isFileSearch ? (
              awaitingRemoteSearch ? (
                <li className="coop-explorer-empty">Searching files…</li>
              ) : searchState.error && fileSearchNodes.length === 0 ? (
                <li className="coop-explorer-empty space-y-2">
                  <div className="break-words">{searchState.error}</div>
                  {searchSettingsHint && onOpenSettings ? (
                    <button
                      type="button"
                      className="coop-settings-action-btn"
                      onClick={() =>
                        onOpenSettings(
                          settingsScreenForProvider(treeState.provider ?? "github") ?? "tools"
                        )
                      }
                    >
                      Open settings to connect GitHub
                    </button>
                  ) : null}
                </li>
              ) : fileSearchNodes.length === 0 ? (
                <li className="coop-explorer-empty">No files match your search.</li>
              ) : (
                fileSearchNodes.map((node) =>
                  node.type === "dir" ? (
                    <li key={node.path}>
                      <button
                        type="button"
                        className="coop-explorer-row"
                        onClick={() => {
                          onExpand(node.path);
                          setQuery("");
                        }}
                      >
                        <span className="coop-explorer-row-chevron" />
                        <span className="coop-explorer-row-icon">
                          <FolderIcon />
                        </span>
                        <span className="coop-explorer-row-name">{node.name}</span>
                        <span className="coop-explorer-row-meta">{node.path}</span>
                      </button>
                    </li>
                  ) : (
                    <SearchResultRow
                      key={node.path}
                      node={node}
                      selectedPath={context.file}
                      onOpenFile={(path) => onOpenFile?.(path)}
                    />
                  )
                )
              )
            ) : treeState.loading && filteredNodes.length === 0 ? (
              <li className="coop-explorer-empty">
                {isRepoList ? "Loading repositories…" : "Loading remote tree…"}
              </li>
            ) : treeState.error ? (
              <li className="coop-explorer-empty space-y-2">
                <div className="break-words">{treeState.error}</div>
                {authHint && onOpenSettings ? (
                  <button
                    type="button"
                    className="coop-settings-action-btn"
                    onClick={() =>
                      onOpenSettings(
                        settingsScreenForProvider(treeState.provider ?? "github") ?? "tools"
                      )
                    }
                  >
                    Open settings to add token
                  </button>
                ) : null}
              </li>
            ) : filteredNodes.length === 0 && !treeState.loading ? (
              <li className="coop-explorer-empty">
                {isRepoList ? (
                  treeState.emptyHint === "workspace" && onOpenSettings ? (
                    <span>
                      Select up to 3 repos in{" "}
                      <button
                        type="button"
                        className="coop-explorer-inline-link"
                        onClick={() => onOpenSettings("workspace")}
                      >
                        Settings → Workspace
                      </button>{" "}
                      to browse files here.
                    </span>
                  ) : trimmedQuery ? (
                    "No repositories match your filter."
                  ) : (
                    "No repositories found. Connect GitHub in Settings."
                  )
                ) : (
                  "No files in this directory."
                )}
              </li>
            ) : (
              filteredNodes.map((node) => {
                const parsed = parseRepoNodePath(node.path);
                const repoId = parsed ? `${parsed.provider}:${parsed.owner}/${parsed.repo}` : undefined;
                return (
                  <TreeRow
                    key={node.path}
                    node={node}
                    depth={0}
                    selectedPath={context.file}
                    selectedRepo={selectedRepo}
                    pickerMode={pickerMode}
                    repoBrowseMode={repoBrowseMode}
                    actionLabel={actionLabel}
                    disabled={repoId ? disabledRepoIds?.has(repoId) : false}
                    onToggle={handleToggle}
                    onOpenRepo={onOpenRepo}
                    onOpenFile={(path) => onOpenFile?.(path)}
                    onPickRepo={handlePickRepo}
                    onUseRepo={onUseRepo}
                  />
                );
              })
            )}
          </ul>
        </div>
      </div>
    </>
  );
}

function repoPathMatchesContext(path: string, selectedRepo?: SelectedRepoContext): boolean {
  if (!selectedRepo) {
    return false;
  }
  const parsed = parseRepoNodePath(path);
  if (!parsed) {
    return false;
  }
  if (parsed.owner !== selectedRepo.owner || parsed.repo !== selectedRepo.repo) {
    return false;
  }
  if (selectedRepo.provider && parsed.provider !== selectedRepo.provider) {
    return false;
  }
  return true;
}

export function buildExplorerBreadcrumb(
  context: RepoContext,
  treeState: ExplorerTreeState
): string {
  const isRepoList = treeState.scope === "repos";
  if (isRepoList) {
    if (treeState.listLabel === "workspace") {
      return "Workspace · Repositories";
    }
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

function flattenLoadedTree(nodes: TreeNodeState[]): TreeNodeState[] {
  const flat: TreeNodeState[] = [];
  const walk = (list: TreeNodeState[]): void => {
    for (const node of list) {
      flat.push(node);
      if (node.children?.length) {
        walk(node.children as TreeNodeState[]);
      }
    }
  };
  walk(nodes);
  return flat;
}
