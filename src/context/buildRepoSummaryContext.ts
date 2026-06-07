import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import { coordinatesFromRepoId, repoIdFromCoordinates, type RepoCoordinates } from "../api/codeHosts/types";
import type { CommitInfo, RemoteTreeEntry } from "../api/codeHosts/types";
import type { ManifestFileEntry } from "../manifest/types";

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
  activeFile?: string;
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
    provider: "github",
    owner: options.owner,
    repo: options.repo,
    branch: options.branch
  };
  const repoId =
    options.repoId ?? repoIdFromCoordinates(coords) ?? `${options.owner}/${options.repo}`;

  const [repository, rootTree, recentCommits, manifest] = await Promise.all([
    options.codeHostRouter.getRepository(coords).catch(() => undefined),
    options.codeHostRouter.getRepositoryTree("", coords).catch(() => undefined),
    options.codeHostRouter
      .getCommitHistory({ ...coords, limit: MAX_RECENT_COMMITS })
      .catch((): CommitInfo[] => []),
    loadManifestSafe(options.loadManifest, repoId)
  ]);

  const branch = repository?.defaultBranch ?? rootTree?.branch ?? options.branch ?? "main";
  const treeOverview = summarizeTree(rootTree?.entries ?? []);
  const srcTree = treeOverview.topLevelDirs.includes("src")
    ? await options.codeHostRouter.getRepositoryTree("src", coords).catch(() => undefined)
    : undefined;
  const srcOverview = srcTree ? summarizeTree(srcTree.entries, "src/") : undefined;

  const manifestStats = manifest.length > 0 ? summarizeManifest(manifest) : undefined;
  const entryPaths = pickEntryPaths({
    manifest,
    treeOverview,
    srcOverview,
    activeFile: options.activeFile
  });
  const entryFiles = await fetchEntryFiles(options.codeHostRouter, coords, entryPaths);

  return {
    repoId,
    branch,
    activeFile: options.activeFile,
    repository: repository
      ? {
          description: repository.description,
          defaultBranch: repository.defaultBranch,
          language: repository.language,
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
}): string[] {
  const manifestPaths = new Set(options.manifest.map((entry) => entry.filePath));
  const available = new Set([
    ...options.treeOverview.topLevelFiles,
    ...options.treeOverview.topLevelDirs.flatMap((dir) => [`${dir}/README.md`]),
    ...(options.srcOverview?.topLevelFiles.map((file) => `src/${file}`) ?? []),
    ...manifestPaths
  ]);

  const picked: string[] = [];
  const push = (path: string | undefined): void => {
    if (!path || picked.includes(path)) {
      return;
    }
    if (!available.has(path) && !manifestPaths.has(path)) {
      return;
    }
    picked.push(path);
  };

  for (const candidate of ENTRY_POINT_CANDIDATES) {
    push(candidate);
    if (picked.length >= MAX_ENTRY_FILES) {
      return picked;
    }
  }

  if (options.activeFile) {
    push(options.activeFile);
  }

  for (const path of manifestPaths) {
    if (picked.length >= MAX_ENTRY_FILES) {
      break;
    }
    if (/^(src\/|docs\/|README)/i.test(path) && /\.(ts|tsx|js|jsx|md|json|yml|yaml)$/i.test(path)) {
      push(path);
    }
  }

  return picked.slice(0, MAX_ENTRY_FILES);
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
      return { owner: slash[0], repo: slash[1], branch: params.branch, repoId: params.repoId };
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
