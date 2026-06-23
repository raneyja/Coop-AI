import { normalizeGraphRepoId } from "../engines/blastRadiusDependentsFallback";
import type { ContextFetchRequest, ContextFetchResult } from "../context/requestBatcher";
import type { IndexBackend } from "./indexBackend";

export type HybridQueryOptions = {
  indexBackend: IndexBackend;
  isEnabled?: (repoId: string) => Promise<boolean>;
};

/**
 * Hybrid query layer: when Lightning Mode is enabled for a repo, enrich results
 * with local/cloud index first, then fall back to the existing remote graph paths.
 */
export class HybridQueryLayer {
  public constructor(private readonly options: HybridQueryOptions) {}

  public async shouldUseHybrid(repoId?: string): Promise<boolean> {
    if (!repoId) {
      return false;
    }
    if (this.options.isEnabled) {
      return this.options.isEnabled(repoId);
    }
    return this.options.indexBackend.isEnabledForRepo(repoId);
  }

  public async queryGraph(remote: GraphQueryApi, request: GraphQueryRequest): Promise<unknown> {
    if (!(await this.shouldUseHybrid(request.repoId))) {
      return remote.queryGraph(request);
    }

    const local = await this.tryLocalGraphQuery(request);
    const remoteResult = await remote.queryGraph(request);
    if (!local) {
      return remoteResult;
    }
    return mergeGraphResults(local, remoteResult, request.query);
  }

  public async enrichContextResult(
    request: ContextFetchRequest,
    base: ContextFetchResult
  ): Promise<ContextFetchResult> {
    const repoId = request.params.repoId;
    if (!(await this.shouldUseHybrid(repoId))) {
      return base;
    }

    const enrichment = await this.localContextEnrichment(request);
    if (!enrichment) {
      return base;
    }

    return {
      ...base,
      data: {
        ...(typeof base.data === "object" && base.data !== null ? (base.data as Record<string, unknown>) : {}),
        lightning: enrichment,
        source: "hybrid"
      },
      stale: Boolean(base.stale) || Boolean(enrichment.stale)
    };
  }

  private async tryLocalGraphQuery(request: GraphQueryRequest): Promise<unknown | undefined> {
    const file = request.filters?.file;
    switch (request.query) {
      case "searchFiles": {
        const pattern = request.filters?.pattern;
        if (!pattern) {
          return undefined;
        }
        const result = await this.options.indexBackend.search(request.repoId, pattern);
        if (result.hits.length === 0 && result.symbols.length === 0) {
          return undefined;
        }
        return {
          repoId: request.repoId,
          data: result.hits.map((hit) => ({
            path: hit.fileName,
            size: hit.content.length,
            lastModified: new Date(),
            lastAuthor: "lightning-index",
            sha: `${hit.lineNumber}`
          })),
          symbols: result.symbols,
          lastUpdated: new Date(),
          freshness: result.source,
          stale: result.stale
        };
      }
      case "getDependents":
      case "getTransitiveDependents": {
        if (!file) {
          return undefined;
        }
        const dependents = await this.options.indexBackend.dependents(request.repoId, file);
        if (dependents.dependents.length === 0) {
          return undefined;
        }
        return {
          repoId: request.repoId,
          data: dependents.dependents.map((path) => ({ from: path, to: file, type: "reference" as const })),
          lastUpdated: new Date(),
          freshness: dependents.source === "scip" ? "scip" : "hybrid",
          stale: false
        };
      }
      default:
        return undefined;
    }
  }

  private async localContextEnrichment(
    request: ContextFetchRequest
  ): Promise<Record<string, unknown> | undefined> {
    const repoId = request.params.repoId ? normalizeGraphRepoId(request.params.repoId) : undefined;
    const file = request.params.file;
    if (!repoId) {
      return undefined;
    }

    const status = await this.options.indexBackend.getRepoStatus(repoId);
    const enrichment: Record<string, unknown> = {
      mode: "lightning",
      backend: this.options.indexBackend.kind,
      indexStatus: status?.status ?? "unknown",
      lastIndexedAt: status?.lastIndexedAt,
      zoektAvailable: status?.zoektAvailable ?? false,
      scipAvailable: status?.scipAvailable ?? false,
      stale: Boolean(status?.lastIndexedAt && Date.now() - Date.parse(status.lastIndexedAt) > 86_400_000)
    };

    switch (request.type) {
      case "dependencies": {
        if (!file) {
          break;
        }
        const dependents = await this.options.indexBackend.dependents(repoId, file);
        enrichment.dependents = dependents.dependents;
        enrichment.dependentsSource = dependents.source;
        break;
      }
      case "chat_context":
      case "file_metadata": {
        if (file) {
          const symbols = await this.options.indexBackend.search(repoId, pathBasename(file));
          enrichment.relatedSymbols = symbols.symbols.slice(0, 10);
          enrichment.searchSource = symbols.source;
        }
        break;
      }
      default:
        break;
    }

    return enrichment;
  }
}

function mergeGraphResults(local: unknown, remote: unknown, query: GraphQueryRequest["query"]): unknown {
  if (!remote || typeof remote !== "object") {
    return local ?? remote;
  }
  if (!local || typeof local !== "object") {
    return remote;
  }

  const remoteRecord = remote as Record<string, unknown>;
  const localRecord = local as Record<string, unknown>;

  if (query === "searchFiles" && Array.isArray(remoteRecord.data) && Array.isArray(localRecord.data)) {
    const merged = dedupeByPath([
      ...(localRecord.data as Array<{ path: string }>),
      ...(remoteRecord.data as Array<{ path: string }>)
    ]);
    return {
      ...remoteRecord,
      data: merged,
      symbols: localRecord.symbols,
      freshness: "hybrid",
      stale: Boolean(remoteRecord.stale) || Boolean(localRecord.stale)
    };
  }

  if (
    (query === "getDependents" || query === "getTransitiveDependents") &&
    Array.isArray(remoteRecord.data) &&
    Array.isArray(localRecord.data)
  ) {
    const key = (edge: { from: string; to: string }) => `${edge.from}->${edge.to}`;
    const seen = new Set<string>();
    const merged = [
      ...(localRecord.data as Array<{ from: string; to: string }>),
      ...(remoteRecord.data as Array<{ from: string; to: string }>)
    ].filter((edge) => {
      const id = key(edge);
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
    return {
      ...remoteRecord,
      data: merged,
      freshness: "hybrid",
      stale: Boolean(remoteRecord.stale) || Boolean(localRecord.stale)
    };
  }

  return remote;
}

function dedupeByPath(items: Array<{ path: string }>): Array<{ path: string }> {
  const seen = new Set<string>();
  const merged: Array<{ path: string }> = [];
  for (const item of items) {
    if (seen.has(item.path)) {
      continue;
    }
    seen.add(item.path);
    merged.push(item);
  }
  return merged;
}

function pathBasename(file: string): string {
  const parts = file.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? file;
}

let sharedHybrid: { backend: IndexBackend; layer: HybridQueryLayer } | undefined;

export function getHybridQueryLayer(indexBackend: IndexBackend): HybridQueryLayer {
  if (!sharedHybrid || sharedHybrid.backend !== indexBackend) {
    sharedHybrid = { backend: indexBackend, layer: new HybridQueryLayer({ indexBackend }) };
  }
  return sharedHybrid.layer;
}

export function resetHybridQueryLayerForTests(): void {
  sharedHybrid = undefined;
}

export async function hybridGraphQuery(
  remote: GraphQueryApi,
  request: GraphQueryRequest,
  indexBackend: IndexBackend
): Promise<unknown> {
  return getHybridQueryLayer(indexBackend).queryGraph(remote, request);
}

export async function hybridEnrichContext(
  request: ContextFetchRequest,
  base: ContextFetchResult,
  indexBackend: IndexBackend
): Promise<ContextFetchResult> {
  return getHybridQueryLayer(indexBackend).enrichContextResult(request, base);
}
