import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import { coordinatesFromRepoId, repoIdFromCoordinates, type RepoCoordinates } from "../api/codeHosts/types";
import type { CommitInfo, RemoteTreeEntry } from "../api/codeHosts/types";
import type { SecureApiClient } from "../chat/SecureApiClient";
import type { CodeHostProviderPreference } from "../chat/types";
import type { ManifestFileEntry } from "../manifest/types";
import { topManifestPaths } from "../manifest/scoreManifest";
import { IndexedRepoWorkspace } from "../workspace/IndexedRepoWorkspace";
import { resolveInventoryRepoIds } from "../workspace/repoInventorySources";
import type { RepoTarget } from "../workspace/indexedRepoWorkspaceTypes";
import { resolveActiveRepoTarget } from "../workspace/repoTargetResolver";
import {
  FOCUS_MAX_ENTRY_PATHS,
  FOCUS_MAX_INJECTED_PATHS,
  focusQueryForRetrieval,
  mergeFocusEntryPaths
} from "./userFocusQuery";
import { onboardingIndexQueries, selectOnboardingEvidencePaths } from "./onboardingSearchQueries";

const MAX_ENTRY_FILES = 6;
const MAX_FILE_CHARS = 12_000;
const MAX_RECENT_COMMITS = 8;
const MAX_TOP_SYMBOLS = 24;

const ENTRY_POINT_CANDIDATES = [
  "package.json",
  "README.md",
  "readme.md",
  "AGENTS.md",
  "docker-compose.yml",
  "src/extension.ts",
  "src/index.ts",
  "src/main.ts",
  "docs/README.md"
];

export type BuildRepoSummaryOptions = {
  codeHostRouter: CodeHostRouter;
  owner: string;
  repo: string;
  branch?: string;
  repoId?: string;
  provider?: CodeHostProviderPreference;
  activeFile?: string;
  /** User focus text — biases entry-file selection toward matching paths. */
  userFocus?: string;
  loadManifest?: (repoId: string) => Promise<ManifestFileEntry[]>;
};

export type RepoSummaryEntryFile = {
  path: string;
  content: string;
  truncated?: boolean;
};

export async function buildLiveRepoSummary(
  options: BuildRepoSummaryOptions
): Promise<Record<string, unknown>> {
  const coords: RepoCoordinates = {
    provider:
      options.provider === "gitlab" || options.provider === "bitbucket" ? options.provider : "github",
    owner: options.owner,
    repo: options.repo,
    branch: options.branch
  };
  const repoId =
    options.repoId ?? repoIdFromCoordinates(coords) ?? `${options.owner}/${options.repo}`;

  const repository = await options.codeHostRouter
    .getRepository({
      provider: coords.provider,
      owner: coords.owner,
      repo: coords.repo
    })
    .catch(() => undefined);
  const resolvedCoords: RepoCoordinates = {
    ...coords,
    branch: options.branch?.trim() || repository?.defaultBranch?.trim() || undefined
  };

  const [rootTree, recentCommits, manifest] = await Promise.all([
    options.codeHostRouter.getRepositoryTree("", resolvedCoords).catch(() => undefined),
    options.codeHostRouter
      .getCommitHistory({ ...resolvedCoords, limit: MAX_RECENT_COMMITS })
      .catch((): CommitInfo[] => []),
    loadManifestSafe(options.loadManifest, repoId)
  ]);

  const branch = rootTree?.branch ?? resolvedCoords.branch;
  const treeOverview = summarizeTree(rootTree?.entries ?? []);
  const srcTree = treeOverview.topLevelDirs.includes("src")
    ? await options.codeHostRouter.getRepositoryTree("src", resolvedCoords).catch(() => undefined)
    : undefined;
  const srcOverview = srcTree ? summarizeTree(srcTree.entries, "src/") : undefined;

  const manifestStats = manifest.length > 0 ? summarizeManifest(manifest) : undefined;
  const entryPaths = pickEntryPaths({
    manifest,
    treeOverview,
    srcOverview,
    activeFile: options.activeFile,
    userFocus: options.userFocus
  });
  const entryFiles = await fetchEntryFiles(options.codeHostRouter, resolvedCoords, entryPaths);

  return {
    repoId,
    branch,
    activeFile: options.activeFile,
    userFocus: focusQueryForRetrieval(options.userFocus),
    repository: repository
      ? {
          defaultBranch: repository.defaultBranch,
          isPrivate: repository.isPrivate,
          htmlUrl: repository.htmlUrl
        }
      : undefined,
    treeOverview: {
      ...treeOverview,
      srcEntries: srcOverview
    },
    manifest: manifestStats,
    entryFiles,
    recentCommits: recentCommits.map(summarizeCommit),
    source: manifestStats ? "code-host-and-manifest" : "code-host"
  };
}

function loadManifestSafe(
  loader: BuildRepoSummaryOptions["loadManifest"],
  repoId: string
): Promise<ManifestFileEntry[]> {
  if (!loader) {
    return Promise.resolve([]);
  }
  return loader(repoId).catch(() => []);
}

function summarizeTree(entries: RemoteTreeEntry[], prefix = ""): {
  topLevelDirs: string[];
  topLevelFiles: string[];
} {
  const topLevelDirs: string[] = [];
  const topLevelFiles: string[] = [];
  for (const entry of entries) {
    const name = entry.name;
    if (entry.type === "dir") {
      topLevelDirs.push(`${prefix}${name}`);
    } else {
      topLevelFiles.push(`${prefix}${name}`);
    }
  }
  topLevelDirs.sort();
  topLevelFiles.sort();
  return { topLevelDirs, topLevelFiles };
}

export function summarizeManifest(manifest: ManifestFileEntry[]): {
  fileCount: number;
  extensionBreakdown: Record<string, number>;
  entryPoints: string[];
  topSymbols: Array<{ file: string; symbol: string; kind: string }>;
} {
  const extensionBreakdown: Record<string, number> = {};
  const topSymbols: Array<{ file: string; symbol: string; kind: string }> = [];

  for (const entry of manifest) {
    const ext = extensionForPath(entry.filePath);
    extensionBreakdown[ext] = (extensionBreakdown[ext] ?? 0) + 1;
    for (const symbol of entry.symbols) {
      if (topSymbols.length >= MAX_TOP_SYMBOLS) {
        break;
      }
      topSymbols.push({ file: entry.filePath, symbol: symbol.name, kind: symbol.kind });
    }
  }

  const entryPoints = ENTRY_POINT_CANDIDATES.filter((candidate) =>
    manifest.some((entry) => entry.filePath === candidate || entry.filePath.endsWith(`/${candidate}`))
  );

  return {
    fileCount: manifest.length,
    extensionBreakdown,
    entryPoints,
    topSymbols
  };
}

export function pickEntryPaths(options: {
  manifest: ManifestFileEntry[];
  treeOverview: { topLevelDirs: string[]; topLevelFiles: string[] };
  srcOverview?: { topLevelDirs: string[]; topLevelFiles: string[] };
  activeFile?: string;
  /** When set, rank manifest paths against the user's ask and merge into anchors. */
  userFocus?: string;
}): string[] {
  const manifestPaths = new Set(options.manifest.map((entry) => entry.filePath));
  const available = new Set([
    ...options.treeOverview.topLevelFiles,
    ...options.treeOverview.topLevelDirs.flatMap((dir) => [`${dir}/README.md`]),
    ...(options.srcOverview?.topLevelFiles.map((file) => `src/${file}`) ?? []),
    ...manifestPaths
  ]);
  // When tree/manifest are empty (timeout / auth blip), still try well-known entry
  // paths — the file fetch will no-op on misses. Gating only on `available` left
  // Understand Repo with zero evidence even for fully indexed repos.
  const allowBlindCandidates = available.size === 0;

  const picked: string[] = [];
  const push = (path: string | undefined, force = false): void => {
    if (!path || picked.includes(path)) {
      return;
    }
    if (!force && !available.has(path) && !manifestPaths.has(path)) {
      return;
    }
    picked.push(path);
  };

  // Active file first — the open tab is the strongest evidence for chat / Understand Repo.
  if (options.activeFile) {
    push(options.activeFile, true);
  }

  const focusQueryEarly = focusQueryForRetrieval(options.userFocus);
  const candidates = focusQueryEarly
    ? ENTRY_POINT_CANDIDATES.filter((candidate) => /^readme\.md$/i.test(candidate))
    : ENTRY_POINT_CANDIDATES;

  for (const candidate of candidates) {
    push(candidate, allowBlindCandidates);
    if (picked.length >= MAX_ENTRY_FILES) {
      break;
    }
  }

  if (!focusQueryEarly) {
    for (const path of manifestPaths) {
      if (picked.length >= MAX_ENTRY_FILES) {
        break;
      }
      if (/^(src\/|docs\/|README)/i.test(path) && /\.(ts|tsx|js|jsx|md|json|yml|yaml)$/i.test(path)) {
        push(path);
      }
    }
  }

  const anchors = picked.slice(0, MAX_ENTRY_FILES);
  const focusQuery = focusQueryForRetrieval(options.userFocus);
  if (!focusQuery || options.manifest.length === 0) {
    return anchors;
  }

  const topicQuery = onboardingIndexQueries(options.userFocus).join(" ") || focusQuery;
  const ranked = topManifestPaths(
    topicQuery,
    { activeFile: options.activeFile },
    options.manifest,
    Math.max(FOCUS_MAX_ENTRY_PATHS * 4, 18)
  );
  const focusPaths = selectOnboardingEvidencePaths(ranked, topicQuery, FOCUS_MAX_INJECTED_PATHS);
  if (focusPaths.length === 0) {
    return anchors;
  }

  return mergeFocusEntryPaths({
    anchorPaths: anchors,
    focusPaths,
    maxPaths: MAX_ENTRY_FILES,
    minAnchors: 1
  });
}

async function fetchEntryFiles(
  router: CodeHostRouter,
  coords: RepoCoordinates,
  paths: string[]
): Promise<RepoSummaryEntryFile[]> {
  const files: RepoSummaryEntryFile[] = [];
  for (const path of paths) {
    try {
      const remote = await router.getFileContent(path, coords);
      const content = remote.content ?? "";
      const truncated = content.length > MAX_FILE_CHARS;
      files.push({
        path: remote.path,
        content: truncated ? `${content.slice(0, MAX_FILE_CHARS)}\n… [truncated]` : content,
        truncated
      });
    } catch {
      // Skip unreadable paths; remaining entry files still anchor the summary.
    }
  }
  return files;
}

function summarizeCommit(commit: CommitInfo): Record<string, string> {
  return {
    sha: commit.sha.slice(0, 8),
    author: commit.authorLogin ?? commit.author,
    date: commit.date,
    message: commit.message.split("\n")[0] ?? commit.message
  };
}

function extensionForPath(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) {
    return "(none)";
  }
  return filePath.slice(dot).toLowerCase();
}

export function resolveRepoSummaryCoords(params: {
  owner?: string;
  repo?: string;
  repoId?: string;
  branch?: string;
  provider?: string;
}): { owner: string; repo: string; branch?: string; repoId: string } | undefined {
  if (params.repoId) {
    const fromId = coordinatesFromRepoId(
      params.repoId.includes(":") ? params.repoId : `github:${params.repoId}`
    );
    if (fromId) {
      return {
        owner: fromId.owner,
        repo: fromId.repo,
        branch: params.branch ?? fromId.branch,
        repoId: params.repoId.includes(":") ? params.repoId : repoIdFromCoordinates(fromId) ?? params.repoId
      };
    }
    const slash = params.repoId.split("/");
    if (slash.length === 2) {
      const provider =
        params.provider === "gitlab" || params.provider === "bitbucket" ? params.provider : "github";
      return {
        owner: slash[0],
        repo: slash[1],
        branch: params.branch,
        repoId: `${provider}:${slash[0]}/${slash[1]}`
      };
    }
  }
  if (params.owner && params.repo) {
    const coords: RepoCoordinates = {
      provider: params.provider === "gitlab" || params.provider === "bitbucket" ? params.provider : "github",
      owner: params.owner,
      repo: params.repo,
      branch: params.branch
    };
    return {
      owner: params.owner,
      repo: params.repo,
      branch: params.branch,
      repoId: repoIdFromCoordinates(coords) ?? `${params.owner}/${params.repo}`
    };
  }
  return undefined;
}

export function hasRepoSummaryEvidence(data: Record<string, unknown> | undefined): boolean {
  if (!data) {
    return false;
  }
  const entryFiles = Array.isArray(data.entryFiles) ? data.entryFiles : [];
  // Path-only stubs are not evidence — require at least one file body.
  if (
    entryFiles.some((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const content = (entry as { content?: unknown }).content;
      return typeof content === "string" && content.trim().length > 0;
    })
  ) {
    return true;
  }
  const manifest = data.manifest;
  if (typeof manifest === "object" && manifest !== null) {
    const fileCount = (manifest as { fileCount?: number }).fileCount;
    if (typeof fileCount === "number" && fileCount > 0) {
      return true;
    }
  }
  const tree = data.treeOverview as { topLevelDirs?: string[]; topLevelFiles?: string[] } | undefined;
  if (
    tree &&
    ((tree.topLevelDirs?.length ?? 0) > 0 || (tree.topLevelFiles?.length ?? 0) > 0)
  ) {
    return true;
  }
  const inventory = data.repoInventory as { fileCount?: number } | undefined;
  if (typeof inventory?.fileCount === "number" && inventory.fileCount > 0) {
    return true;
  }
  // Bare code-host `repository` metadata is identity only — not enough to synthesize.
  return false;
}

export async function loadManifestEntries(
  api: SecureApiClient,
  apiBaseUrl: string,
  candidateRepoIds: string[]
): Promise<ManifestFileEntry[]> {
  for (const candidate of candidateRepoIds) {
    try {
      const response = await api.fetchRepoManifest(apiBaseUrl, candidate);
      const files = response.files ?? [];
      if (files.length === 0 && !response.lastCrawledAt) {
        continue;
      }
      return files.map((file) => ({
        filePath: file.path,
        symbols: (file.symbols ?? []) as ManifestFileEntry["symbols"]
      }));
    } catch {
      continue;
    }
  }
  return [];
}

export type BuildIndexedRepoSummaryOptions = {
  api: SecureApiClient;
  apiBaseUrl: string;
  codeHostRouter: CodeHostRouter;
  owner: string;
  repo: string;
  branch?: string;
  repoId: string;
  provider?: CodeHostProviderPreference;
  activeFile?: string;
  userFocus?: string;
  resolveWorkspaceBranch?: (repoId: string) => Promise<string | undefined>;
};

/** Indexed-repo fallback when live code-host summary returns no attachable evidence. */
export async function buildIndexedRepoSummary(
  options: BuildIndexedRepoSummaryOptions
): Promise<Record<string, unknown> | undefined> {
  const target = await resolveActiveRepoTarget(
    {
      repoId: options.repoId,
      owner: options.owner,
      repo: options.repo,
      branch: options.branch,
      provider: options.provider
    },
    {
      api: options.api,
      apiBaseUrl: options.apiBaseUrl,
      codeHostRouter: options.codeHostRouter,
      resolveWorkspaceBranch: options.resolveWorkspaceBranch
    }
  );
  const branch = target.branch ?? options.branch;

  const workspace = new IndexedRepoWorkspace({
    api: options.api,
    apiBaseUrl: options.apiBaseUrl,
    codeHostRouter: options.codeHostRouter
  });
  const provider =
    options.provider === "gitlab" || options.provider === "bitbucket" ? options.provider : "github";
  const resolvedTarget: RepoTarget = { ...target, provider };
  const resolved = resolveInventoryRepoIds(options.repoId, resolvedTarget);

  const [manifest, treeOverview, inventory] = await Promise.all([
    loadManifestEntries(options.api, options.apiBaseUrl, resolved.candidates),
    workspace.getTreeOverview(resolvedTarget),
    workspace.getInventory(resolvedTarget, {
      fileCount: true,
      treeOverview: false,
      lineCount: false,
      packageManifests: false
    })
  ]);

  const manifestStats = manifest.length > 0 ? summarizeManifest(manifest) : undefined;
  const treeForPick = {
    topLevelDirs: treeOverview?.topLevelDirs ?? [],
    topLevelFiles: treeOverview?.topLevelFiles ?? []
  };
  const entryPaths = pickEntryPaths({
    manifest,
    treeOverview: treeForPick,
    activeFile: options.activeFile,
    userFocus: options.userFocus
  });

  const entryFiles: RepoSummaryEntryFile[] = [];
  for (const path of entryPaths) {
    const file = await workspace.readFile(resolvedTarget, path);
    if (!file?.content?.trim()) {
      continue;
    }
    const truncated = file.content.length > MAX_FILE_CHARS;
    entryFiles.push({
      path: file.path,
      content: truncated ? `${file.content.slice(0, MAX_FILE_CHARS)}\n… [truncated]` : file.content,
      truncated
    });
  }

  if (!manifestStats && entryFiles.length === 0 && !treeOverview) {
    return undefined;
  }

  return {
    repoId: resolved.preferred,
    branch: treeOverview?.branch ?? branch ?? inventory?.branch,
    activeFile: options.activeFile,
    userFocus: focusQueryForRetrieval(options.userFocus),
    treeOverview: treeOverview
      ? {
          topLevelDirs: treeOverview.topLevelDirs,
          topLevelFiles: treeOverview.topLevelFiles
        }
      : undefined,
    manifest: manifestStats
      ? {
          fileCount: manifestStats.fileCount,
          entryPoints: manifestStats.entryPoints,
          extensionBreakdown: manifestStats.extensionBreakdown
        }
      : inventory && typeof inventory.fileCount === "number"
        ? { fileCount: inventory.fileCount }
        : undefined,
    entryFiles,
    source: manifestStats ? "indexed-manifest" : entryFiles.length > 0 ? "indexed-files" : "indexed-tree"
  };
}

export type BuildRepoSummaryEvidenceOptions = {
  api: SecureApiClient;
  apiBaseUrl: string;
  codeHostRouter: CodeHostRouter;
  owner: string;
  repo: string;
  branch?: string;
  repoId: string;
  provider?: CodeHostProviderPreference;
  activeFile?: string;
  /** Specific user ask — biases entry files via manifest scoring. */
  userFocus?: string;
  resolveWorkspaceBranch?: (repoId: string) => Promise<string | undefined>;
};

/** Live code-host summary with indexed-workspace fallback — shared by Understand Repo and /understand. */
export async function buildRepoSummaryEvidence(
  options: BuildRepoSummaryEvidenceOptions
): Promise<Record<string, unknown> | undefined> {
  const target = await resolveActiveRepoTarget(
    {
      repoId: options.repoId,
      owner: options.owner,
      repo: options.repo,
      branch: options.branch,
      provider: options.provider
    },
    {
      api: options.api,
      apiBaseUrl: options.apiBaseUrl,
      codeHostRouter: options.codeHostRouter,
      resolveWorkspaceBranch: options.resolveWorkspaceBranch
    }
  );
  const branch = target.branch ?? options.branch;
  const userFocus = focusQueryForRetrieval(options.userFocus);

  const manifestCandidates = resolveInventoryRepoIds(options.repoId, {
    owner: options.owner,
    repo: options.repo,
    branch,
    provider:
      options.provider === "gitlab" || options.provider === "bitbucket" ? options.provider : "github"
  }).candidates;

  const indexed = await buildIndexedRepoSummary({
    api: options.api,
    apiBaseUrl: options.apiBaseUrl,
    codeHostRouter: options.codeHostRouter,
    owner: options.owner,
    repo: options.repo,
    branch,
    repoId: options.repoId,
    activeFile: options.activeFile,
    userFocus,
    provider: options.provider,
    resolveWorkspaceBranch: options.resolveWorkspaceBranch
  });

  if (hasRepoSummaryEvidence(indexed)) {
    return indexed;
  }

  const summaryBase: BuildRepoSummaryOptions = {
    codeHostRouter: options.codeHostRouter,
    owner: options.owner,
    repo: options.repo,
    branch,
    repoId: options.repoId,
    provider: options.provider,
    activeFile: options.activeFile,
    userFocus,
    loadManifest: async (repoId: string): Promise<ManifestFileEntry[]> =>
      loadManifestEntries(options.api, options.apiBaseUrl, manifestCandidates.length ? manifestCandidates : [repoId])
  };

  let live: Record<string, unknown> | undefined;
  try {
    live = await buildLiveRepoSummary(summaryBase);
  } catch {
    live = undefined;
  }

  if (hasRepoSummaryEvidence(live)) {
    return live;
  }

  if (indexed) {
    return {
      ...(live ?? {}),
      ...indexed,
      entryFiles: indexed.entryFiles ?? live?.entryFiles,
      manifest: indexed.manifest ?? live?.manifest,
      treeOverview: indexed.treeOverview ?? live?.treeOverview,
      source: live?.source ? `${String(live.source)}+${String(indexed.source)}` : indexed.source
    };
  }

  return live;
}
