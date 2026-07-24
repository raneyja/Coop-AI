import type { RemoteTree } from "../api/codeHosts/types";

export type TreeWalkFileCount = {
  fileCount: number;
  truncated: boolean;
  dirsVisited: number;
};

const DEFAULT_MAX_DIRS = 1500;
const DEFAULT_CONCURRENCY = 8;

/**
 * Count blobs by walking directory trees one level at a time.
 * Used when recursive git-tree APIs are unavailable (cloud proxy / single-dir tree only).
 */
export async function countFilesViaDirectoryWalk(
  loadTree: (dirPath: string) => Promise<RemoteTree>,
  options?: { maxDirs?: number; concurrency?: number }
): Promise<TreeWalkFileCount> {
  const maxDirs = options?.maxDirs ?? DEFAULT_MAX_DIRS;
  const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_CONCURRENCY);
  const queue: string[] = [""];
  const seen = new Set<string>();
  let fileCount = 0;
  let dirsVisited = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (dirsVisited >= maxDirs) {
      truncated = true;
      break;
    }

    const batch: string[] = [];
    while (batch.length < concurrency && queue.length > 0 && dirsVisited + batch.length < maxDirs) {
      const next = queue.shift()!;
      const key = next || "/";
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      batch.push(next);
    }
    if (batch.length === 0) {
      break;
    }

    const trees = await Promise.all(
      batch.map(async (dirPath) => {
        try {
          return await loadTree(dirPath);
        } catch {
          return undefined;
        }
      })
    );

    for (const tree of trees) {
      dirsVisited += 1;
      if (!tree) {
        continue;
      }
      for (const entry of tree.entries ?? []) {
        if (entry.type === "dir") {
          queue.push(entry.path);
        } else {
          fileCount += 1;
        }
      }
    }
  }

  if (queue.length > 0) {
    truncated = true;
  }

  return { fileCount, truncated, dirsVisited };
}
