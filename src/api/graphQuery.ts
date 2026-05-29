import { GraphCache, GraphQueryFilters } from "../cache/graphCache";
import { metadataConflictFromIssue } from "../conflicts/metadataResolution";
import { ConflictResolutionStrategy } from "../conflicts/resolutionStrategy";

export type GraphQueryName =
  | "getFileTree"
  | "getOwnership"
  | "getDependents"
  | "getTransitiveDependents"
  | "getRecentChanges"
  | "searchFiles"
  | "getConflicts";

export type GraphQueryRequest = {
  repoId: string;
  query: GraphQueryName;
  filters?: GraphQueryFilters & {
    file?: string;
    pattern?: string;
    days?: number;
    forceRefresh?: boolean;
  };
};

export type GraphQueryApiOptions = {
  cache: GraphCache;
  refresh?: (repoId: string) => Promise<void>;
};

export class GraphQueryApi {
  public constructor(private readonly options: GraphQueryApiOptions) {}

  public async queryGraph(request: GraphQueryRequest): Promise<unknown> {
    if (request.filters?.forceRefresh && this.options.refresh) {
      await this.options.refresh(request.repoId);
    }

    switch (request.query) {
      case "getFileTree":
        return this.options.cache.getFileTree(request.repoId);
      case "getOwnership":
        return this.options.cache.getOwnership(request.repoId, required(request.filters?.file, "file"));
      case "getDependents":
        return this.options.cache.getDependents(request.repoId, required(request.filters?.file, "file"));
      case "getTransitiveDependents":
        return this.options.cache.getTransitiveDependents(request.repoId, required(request.filters?.file, "file"));
      case "getRecentChanges":
        return this.options.cache.getRecentChanges(request.repoId, request.filters?.days ?? 7, request.filters);
      case "searchFiles":
        return this.options.cache.searchFiles(request.repoId, required(request.filters?.pattern, "pattern"));
      case "getConflicts":
        return this.getConflicts(request.repoId);
    }
  }

  private getConflicts(repoId: string): unknown {
    const graph = this.options.cache.getGraph(repoId);
    if (!graph) {
      return undefined;
    }
    const conflicts = graph.pullRequests.flatMap((pr) =>
      graph.issues.flatMap((issue) => metadataConflictFromIssue(pr, issue))
    );
    const resolver = new ConflictResolutionStrategy();
    return {
      repoId,
      conflicts,
      resolutions: resolver.resolveMany(conflicts),
      lastUpdated: graph.lastUpdated,
      stale: false
    };
  }
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required graph query filter: ${name}`);
  }
  return value;
}
