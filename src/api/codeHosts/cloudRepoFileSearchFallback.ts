import { rankExplorerFilePaths } from "./explorerFileTreeSearch";

export type CloudTreeListing = {
  entries: Array<{ path: string; name: string; type: "file" | "dir" }>;
};

export function isRemoteFileSearchFallbackCandidate(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("403") ||
      message.includes("422") ||
      message.includes("status code 403") ||
      message.includes("status code 422") ||
      message.includes("validation failed") ||
      message.includes("code search")
    );
  }
  return false;
}

/** Walk remote directories via cloud tree API when GitHub /search/code is unavailable. */
export async function searchFilesViaCloudTree(
  fetchTree: (path: string) => Promise<CloudTreeListing>,
  query: string,
  limit = 30
): Promise<Array<{ path: string; name: string }>> {
  const normalizedQuery = query.trim().replace(/^\/+/, "");
  if (!normalizedQuery) {
    return [];
  }

  if (normalizedQuery.includes("/")) {
    const parent = normalizedQuery.includes("/")
      ? normalizedQuery.slice(0, normalizedQuery.lastIndexOf("/"))
      : "";
    try {
      const tree = await fetchTree(parent);
      const filePaths = tree.entries
        .filter((entry) => entry.type === "file")
        .map((entry) => entry.path);
      return rankExplorerFilePaths(filePaths, normalizedQuery, limit).map((path) => ({
        path,
        name: path.split("/").pop() ?? path
      }));
    } catch {
      // Fall through to BFS.
    }
  }

  const filePaths: string[] = [];
  const queue: string[] = ["", "src", "lib", "server", "src/server"];
  const visited = new Set<string>();
  const maxDirs = 48;

  while (queue.length > 0 && visited.size < maxDirs) {
    const dir = queue.shift() ?? "";
    if (visited.has(dir)) {
      continue;
    }
    visited.add(dir);
    let tree: CloudTreeListing;
    try {
      tree = await fetchTree(dir);
    } catch {
      continue;
    }
    for (const entry of tree.entries) {
      if (entry.type === "file") {
        filePaths.push(entry.path);
      } else if (entry.type === "dir" && !visited.has(entry.path)) {
        queue.push(entry.path);
      }
    }
    const ranked = rankExplorerFilePaths(filePaths, normalizedQuery, limit);
    if (ranked.length >= limit) {
      return ranked.map((path) => ({ path, name: path.split("/").pop() ?? path }));
    }
  }

  return rankExplorerFilePaths(filePaths, normalizedQuery, limit).map((path) => ({
    path,
    name: path.split("/").pop() ?? path
  }));
}
