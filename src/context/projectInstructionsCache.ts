import * as fs from "node:fs";
import * as vscode from "vscode";
import { readProjectInstructionsEnabled } from "../config/projectInstructionsConfig";
import { resolveLocalAbsolutePath } from "./localFileResolver";
import {
  loadProjectInstructions,
  resolveProjectInstructionsGitRoot,
  type ProjectInstructionFile
} from "./projectInstructionsLoader";

type CacheEntry = {
  cacheKey: string;
  files: ProjectInstructionFile[];
  mtimes: Map<string, number>;
};

const cache: { entry?: CacheEntry } = {};

function statMtimeMs(absolutePath: string): number | undefined {
  try {
    return fs.statSync(absolutePath).mtimeMs;
  } catch {
    return undefined;
  }
}

function cacheKeyFor(gitRoot: string, activeFile?: string): string {
  const normalizedFile = activeFile?.trim().replace(/\\/g, "/").replace(/^\.?\//, "") ?? "";
  return `${gitRoot}::${normalizedFile}`;
}

function isCacheValid(entry: CacheEntry, sourcePaths: string[]): ProjectInstructionFile[] | undefined {
  if (sourcePaths.length !== entry.mtimes.size) {
    return undefined;
  }
  for (const sourcePath of sourcePaths) {
    const mtime = statMtimeMs(sourcePath);
    if (mtime === undefined || entry.mtimes.get(sourcePath) !== mtime) {
      return undefined;
    }
  }
  return entry.files;
}

export function clearProjectInstructionsCache(): void {
  cache.entry = undefined;
}

export function loadProjectInstructionsCached(options: {
  activeFile?: string;
  enabled?: boolean;
}): ProjectInstructionFile[] {
  const enabled = options.enabled ?? readProjectInstructionsEnabled();
  if (!enabled) {
    return [];
  }

  const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  const gitRoot = resolveProjectInstructionsGitRoot({
    activeFile: options.activeFile,
    resolveAbsolutePath: resolveLocalAbsolutePath,
    workspaceRoots
  });
  if (!gitRoot) {
    return [];
  }

  const key = cacheKeyFor(gitRoot, options.activeFile);
  const loaded = loadProjectInstructions({ gitRoot, activeFile: options.activeFile });
  if (!loaded.files.length) {
    cache.entry = undefined;
    return [];
  }

  const mtimes = new Map<string, number>();
  for (const sourcePath of loaded.sourcePaths) {
    const mtime = statMtimeMs(sourcePath);
    if (mtime === undefined) {
      cache.entry = undefined;
      return loaded.files;
    }
    mtimes.set(sourcePath, mtime);
  }

  if (cache.entry?.cacheKey === key) {
    const cached = isCacheValid(cache.entry, loaded.sourcePaths);
    if (cached) {
      return cached;
    }
  }

  cache.entry = {
    cacheKey: key,
    files: loaded.files,
    mtimes
  };
  return loaded.files;
}
