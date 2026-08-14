import * as fs from "node:fs";
import {
  loadProjectInstructions,
  loadRemoteProjectInstructions,
  resolveProjectInstructionsGitRoot,
  type ProjectInstructionFile
} from "./projectInstructionsLoader";

export const PROJECT_INSTRUCTIONS_CACHE_TTL_MS = 5_000;

type CacheEntry = {
  cacheKey: string;
  files: ProjectInstructionFile[];
  sourcePaths: string[];
  mtimes: Map<string, number>;
  expiresAt: number;
};

const cache: { entry?: CacheEntry } = {};

function statMtimeMs(absolutePath: string): number | undefined {
  try {
    return fs.statSync(absolutePath).mtimeMs;
  } catch {
    return undefined;
  }
}

function normalizeCacheKeySegment(value: string | undefined): string {
  return value?.trim().replace(/\\/g, "/").replace(/^\.?\//, "") ?? "";
}

function cacheKeyFor(gitRoot: string, activeFile?: string, attachedAgentsMdPath?: string): string {
  return `${normalizeCacheKeySegment(gitRoot)}::${normalizeCacheKeySegment(activeFile)}::${normalizeCacheKeySegment(attachedAgentsMdPath)}`;
}

function isCacheValid(entry: CacheEntry, now: number): ProjectInstructionFile[] | undefined {
  if (now > entry.expiresAt) {
    return undefined;
  }
  if (entry.sourcePaths.length !== entry.mtimes.size) {
    return undefined;
  }
  for (const sourcePath of entry.sourcePaths) {
    const mtime = statMtimeMs(sourcePath);
    if (mtime === undefined || entry.mtimes.get(sourcePath) !== mtime) {
      return undefined;
    }
  }
  return entry.files;
}

export function clearProjectInstructionsCache(): void {
  cache.entry = undefined;
  remoteCache.clear();
}

export const REMOTE_INSTRUCTIONS_HIT_TTL_MS = 10 * 60 * 1000;
export const REMOTE_INSTRUCTIONS_MISS_TTL_MS = 30_000;

type RemoteCacheEntry = {
  cacheKey: string;
  files: ProjectInstructionFile[];
  expiresAt: number;
};

const remoteCache = new Map<string, RemoteCacheEntry>();

function remoteCacheKey(repoId: string, branch?: string, version?: string): string {
  return `remote::${normalizeCacheKeySegment(repoId)}::${normalizeCacheKeySegment(branch)}::${normalizeCacheKeySegment(version)}`;
}

export function peekRemoteProjectInstructionsCache(
  repoId: string,
  branch?: string,
  version?: string,
  now = Date.now()
): ProjectInstructionFile[] | undefined {
  const key = remoteCacheKey(repoId, branch, version);
  const entry = remoteCache.get(key);
  if (!entry || now > entry.expiresAt) {
    return undefined;
  }
  return entry.files;
}

export type LoadRemoteProjectInstructionsCachedOptions = {
  repoId: string;
  branch?: string;
  version?: string;
  timeoutMs: number;
  readFile: (path: string) => Promise<string | undefined>;
  now?: number;
};

export async function loadRemoteProjectInstructionsCached(
  options: LoadRemoteProjectInstructionsCachedOptions
): Promise<ProjectInstructionFile[]> {
  const now = options.now ?? Date.now();
  const key = remoteCacheKey(options.repoId, options.branch, options.version);
  const hit = peekRemoteProjectInstructionsCache(options.repoId, options.branch, options.version, now);
  if (hit) {
    return hit;
  }

  if (options.timeoutMs <= 0) {
    return [];
  }

  const loaded = await loadRemoteProjectInstructions({
    readFile: options.readFile,
    timeoutMs: options.timeoutMs
  });
  remoteCache.set(key, {
    cacheKey: key,
    files: loaded.files,
    expiresAt: now + (loaded.files.length ? REMOTE_INSTRUCTIONS_HIT_TTL_MS : REMOTE_INSTRUCTIONS_MISS_TTL_MS)
  });
  return loaded.files;
}

export type LoadProjectInstructionsCachedOptions = {
  activeFile?: string;
  enabled?: boolean;
  attachedAgentsMdPath?: string;
  gitRoot?: string;
  resolveAbsolutePath?: (relativePath: string) => string | undefined;
  workspaceRoots?: string[];
};

export function loadProjectInstructionsCached(options: LoadProjectInstructionsCachedOptions): ProjectInstructionFile[] {
  if (options.enabled === false) {
    return [];
  }

  const gitRoot =
    options.gitRoot ??
    resolveProjectInstructionsGitRoot({
      activeFile: options.activeFile,
      resolveAbsolutePath: options.resolveAbsolutePath,
      workspaceRoots: options.workspaceRoots ?? []
    });
  if (!gitRoot) {
    return [];
  }

  const key = cacheKeyFor(gitRoot, options.activeFile, options.attachedAgentsMdPath);
  const now = Date.now();

  if (cache.entry?.cacheKey === key) {
    const cached = isCacheValid(cache.entry, now);
    if (cached) {
      return cached;
    }
  }

  const loaded = loadProjectInstructions({ gitRoot, activeFile: options.activeFile });
  const mtimes = new Map<string, number>();
  for (const sourcePath of loaded.sourcePaths) {
    const mtime = statMtimeMs(sourcePath);
    if (mtime === undefined) {
      continue;
    }
    mtimes.set(sourcePath, mtime);
  }

  cache.entry = {
    cacheKey: key,
    files: loaded.files,
    sourcePaths: loaded.sourcePaths,
    expiresAt: now + PROJECT_INSTRUCTIONS_CACHE_TTL_MS,
    mtimes
  };
  return cache.entry.files;
}
