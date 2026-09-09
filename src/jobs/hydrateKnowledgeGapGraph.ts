import type { DependencyEdge, FileNode, OwnershipEntry, RepositoryGraph } from "../cache/graphCache";

export type KnowledgeGapGraphSlice = Pick<RepositoryGraph, "fileTree" | "dependencies" | "owners">;

export function fileNodesFromPaths(paths: string[], lastModified = new Date()): FileNode[] {
  const unique = [...new Set(paths.map((path) => path.replace(/\\/g, "/")).filter(Boolean))];
  return unique.map((path) => ({
    path,
    size: 0,
    lastModified,
    lastAuthor: "index",
    sha: ""
  }));
}

export function pathsFromDependencyEdges(edges: DependencyEdge[]): string[] {
  const paths = new Set<string>();
  for (const edge of edges) {
    if (edge.from) {
      paths.add(edge.from);
    }
    if (edge.to) {
      paths.add(edge.to);
    }
  }
  return [...paths];
}

export function knowledgeGapRepoIdCandidates(
  repoId: string,
  params?: { owner?: unknown; repo?: unknown }
): string[] {
  const ids: string[] = [];
  const trimmed = repoId.trim();
  if (trimmed) {
    ids.push(trimmed);
  }
  const owner = typeof params?.owner === "string" ? params.owner.trim() : "";
  const repo = typeof params?.repo === "string" ? params.repo.trim() : "";
  if (owner && repo) {
    ids.push(`${owner}/${repo}`, `github:${owner}/${repo}`);
  }
  return [...new Set(ids)];
}

/**
 * Build a scanable file map from memory graph, structure manifest, and durable
 * import edges. Empty in-memory graphs are not a source of truth.
 */
export function hydrateKnowledgeGapGraphSlice(input: {
  fileTree?: FileNode[];
  memoryEdges?: DependencyEdge[];
  manifestPaths?: string[];
  durableEdges?: DependencyEdge[];
  owners?: OwnershipEntry[];
}): KnowledgeGapGraphSlice | undefined {
  const memoryTree = (input.fileTree ?? []).filter((file) => file.path?.trim());
  const durableEdges = input.durableEdges ?? [];
  const memoryEdges = (input.memoryEdges ?? []).filter((edge) => edge.from && edge.to);
  const dependencies = memoryEdges.length > 0 ? memoryEdges : durableEdges;
  const manifestPaths = input.manifestPaths ?? [];
  const paths =
    memoryTree.length > 0
      ? memoryTree.map((file) => file.path)
      : [...new Set([...manifestPaths, ...pathsFromDependencyEdges(dependencies)])];
  if (paths.length === 0) {
    return undefined;
  }
  return {
    fileTree: memoryTree.length > 0 ? memoryTree : fileNodesFromPaths(paths),
    dependencies,
    owners: input.owners ?? []
  };
}
