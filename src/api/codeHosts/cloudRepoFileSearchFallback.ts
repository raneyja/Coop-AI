import { rankExplorerFilePaths } from "./explorerFileTreeSearch";

export type CloudTreeListing = {
  entries: Array<{ path: string; name: string; type: "file" | "dir" }>;
};

/**
 * Keep indexed graph hits ahead of a bounded tree walk. The tree is a live
 * fallback, but its result cap must not hide a path already found by the
 * repository's indexed filename search.
 */
export function mergeRemoteFileSearchHits(
  preferred: Array<{ path: string; name: string }>,
  fallback: Array<{ path: string; name: string }>,
  limit: number
): Array<{ path: string; name: string }> {
  return [...new Map([...preferred, ...fallback].map((hit) => [hit.path, hit])).values()]
    .slice(0, Math.max(1, limit));
}

export function isRemoteFileSearchFallbackCandidate(error: unknown): boolean {
  const details = error as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  } | undefined;
  const status = details?.status ?? details?.response?.status;
  if (details?.code === "unsupported" || status === 400 || status === 403 || status === 422) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const structured = error as Error & { code?: unknown; status?: unknown; response?: { status?: unknown } };
    const status = typeof structured.status === "number"
      ? structured.status
      : typeof structured.response?.status === "number"
        ? structured.response.status
        : undefined;
    return (
      structured.code === "unsupported" ||
      message.includes("403") ||
      message.includes("400") ||
      message.includes("422") ||
      message.includes("404") ||
      status === 400 ||
      status === 403 ||
      status === 404 ||
      status === 422 ||
      message.includes("status code 403") ||
      message.includes("status code 400") ||
      message.includes("status code 404") ||
      message.includes("status code 422") ||
      message.includes("validation failed") ||
      message.includes("code search") ||
      message.includes("isn't supported") ||
      message.includes("advanced search")
    );
  }
  return false;
}

/** Walk remote directories via cloud tree API when GitHub /search/code is unavailable. */
export async function searchFilesViaCloudTree(
  fetchTree: (path: string) => Promise<CloudTreeListing>,
  query: string,
  limit = 30,
  acceptPath: (path: string) => boolean = () => true
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
        .filter((entry) => entry.type === "file" && acceptPath(entry.path))
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
  const directoryPriority = (dir: string): number => {
    const segments = dir.toLowerCase().split("/");
    const queryWords = normalizedQuery.toLowerCase().match(/[a-z][a-z0-9_]+/g) ?? [];
    const leaf = segments.at(-1) ?? "";
    const source = /^(server(?:-only)?|backend|api)$/;
    return (source.test(leaf) ? 5 : 0) +
      (/^(src|lib|packages|services|functions|handlers)$/.test(leaf) ? 2 : 0) +
      (queryWords.some((word) => leaf.includes(word)) ? 4 : 0) +
      (segments.slice(0, -1).some((segment) => source.test(segment)) ? 2 : 0) -
      (segments.some((segment) => /^(node_modules|vendor|dist|build|docs|migrations|\.git|\.github|\.agents)$/.test(segment)) ? 8 : 0) - segments.length * 0.5;
  };

  while (queue.length > 0 && visited.size < maxDirs) {
    // Spend the bounded remote walk on likely source areas before tooling and
    // documentation. Plain BFS exhausts wide monorepos before reaching handlers.
    queue.sort((a, b) => directoryPriority(b) - directoryPriority(a));
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
      if (entry.type === "file" && acceptPath(entry.path)) {
        filePaths.push(entry.path);
      } else if (entry.type === "dir" && !visited.has(entry.path)) {
        queue.push(entry.path);
      }
    }
    // Do not stop when the first `limit` matches are found. A broad filename
    // query can fill the cap with shallow UI/tooling paths before the bounded
    // walk reaches a deeper backend handler. Collect the complete bounded
    // pool, then rank and cap once at the end.
  }

  return rankExplorerFilePaths(filePaths, normalizedQuery, limit).map((path) => ({
    path,
    name: path.split("/").pop() ?? path
  }));
}
