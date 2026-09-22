import type { Pool } from "pg";
import { GraphQueryApi, type GraphQueryName } from "../api/graphQuery";
import type { GraphCache } from "../cache/graphCache";
import { parseGraphSearchScope } from "../indexing/graphSearchScope";
import {
  lightningSearch,
  type LightningSearchOptions,
  type LightningSearchResult
} from "../indexing/lightningSearch";
import { orgOwnsRepo, type RepoAccessCaller } from "../indexing/orgRepoMembership";
import { RepoDependencyEdgesStore } from "../indexing/repoDependencyEdgesStore";

export type GraphHttpResult = {
  statusCode: number;
  body: unknown;
};

/**
 * `/graph/*` after auth. A repo the caller does not own never reaches Zoekt
 * or GraphCache. Collection and scope searches still pass through membership
 * inside `resolveSearchRepoIds`.
 */
export async function handleGraphHttp(input: {
  pathname: string;
  searchParams: URLSearchParams;
  orgId: string;
  caller?: RepoAccessCaller;
  pool: Pool;
  cache: GraphCache;
  graphQuery: GraphQueryApi;
  onSearch?: (metadata: Record<string, unknown>) => Promise<void>;
}): Promise<GraphHttpResult> {
  const [repoId, query] = parseGraphPath(input.pathname);
  const filters = {
    file: input.searchParams.get("file") ?? undefined,
    pattern: input.searchParams.get("pattern") ?? undefined,
    collectionId: input.searchParams.get("collectionId") ?? undefined,
    scope: parseGraphSearchScope(input.searchParams.get("scope")),
    mention: input.searchParams.get("mention") === "true",
    days: numberParam(input.searchParams.get("days")),
    forceRefresh: input.searchParams.get("forceRefresh") === "true"
  };

  const repoScoped = !filters.collectionId && !filters.scope;
  if (repoScoped) {
    const visible = await orgOwnsRepo(input.pool, input.orgId, repoId, input.caller);
    if (!visible) {
      return { statusCode: 404, body: { error: "graph not found" } };
    }
  }

  let result: unknown;
  if (query === "searchFiles" && filters.pattern) {
    const searchOptions: LightningSearchOptions = filters.collectionId
      ? {
          collectionId: filters.collectionId,
          pattern: filters.pattern,
          mention: filters.mention,
          caller: input.caller
        }
      : filters.scope
        ? {
            scope: filters.scope,
            pattern: filters.pattern,
            mention: filters.mention,
            caller: input.caller
          }
        : {
            repoId,
            pattern: filters.pattern,
            mention: filters.mention,
            caller: input.caller
          };
    const lightning = await lightningSearch(input.pool, input.orgId, searchOptions);
    if (lightning.hits.length > 0 || lightning.symbols.length > 0) {
      result = formatLightningSearchResult(
        filters.collectionId ? undefined : repoId,
        lightning,
        filters.collectionId
      );
    }
    await input.onSearch?.({
      pattern: filters.pattern,
      collectionId: filters.collectionId,
      repoId: filters.collectionId ? undefined : repoId,
      hitCount: lightning.hits.length + lightning.symbols.length
    });
  }

  if (!result && query === "getDependents" && filters.file && repoScoped) {
    try {
      const edgeStore = new RepoDependencyEdgesStore(input.pool);
      const edgeCount = await edgeStore.countEdges(input.orgId, repoId);
      if (edgeCount > 0) {
        const edges = await edgeStore.loadDependentsForFile(input.orgId, repoId, filters.file);
        const source = edges.length > 0 ? (edges[0]?.source ?? "import-parse") : "remote";
        result = {
          repoId,
          data: edges.map((edge) => ({
            from: edge.fromPath,
            to: edge.toPath,
            type: edge.kind,
            symbol: edge.symbol,
            line: edge.line,
            source: edge.source
          })),
          lastUpdated: new Date(),
          freshness: source,
          stale: false
        };
      }
    } catch (error) {
      console.warn(
        `[graph] durable dependents lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (!result && repoScoped) {
    await input.cache.ensureLoaded(input.orgId, repoId);
    result = await input.graphQuery.queryGraph({
      orgId: input.orgId,
      repoId,
      query,
      filters
    });
  }

  if (!result && !repoScoped && query !== "searchFiles") {
    return { statusCode: 404, body: { error: "graph not found" } };
  }

  return {
    statusCode: result ? 200 : 404,
    body: result ?? { error: "graph not found" }
  };
}

export function parseGraphPath(pathname: string): [string, GraphQueryName] {
  const parts = pathname.split("/").filter(Boolean);
  const repoId = decodeURIComponent(parts[1] ?? "");
  const segment = parts[2] ?? "tree";
  const queryBySegment: Record<string, GraphQueryName> = {
    tree: "getFileTree",
    ownership: "getOwnership",
    dependents: "getDependents",
    "transitive-dependents": "getTransitiveDependents",
    changes: "getRecentChanges",
    search: "searchFiles",
    conflicts: "getConflicts"
  };
  const query = queryBySegment[segment];
  if (!repoId || !query) {
    throw new Error("invalid graph query path");
  }
  return [repoId, query];
}

function numberParam(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatLightningSearchResult(
  repoId: string | undefined,
  search: LightningSearchResult,
  collectionId?: string
): unknown {
  return {
    repoId,
    collectionId,
    data: search.hits.map((hit) => ({
      repoId: hit.repoId,
      path: hit.path,
      content: hit.content,
      source: hit.source,
      size: hit.content.length,
      lastModified: new Date(),
      lastAuthor: "lightning-index",
      sha: String(hit.lineNumber),
      line: hit.lineNumber,
      score: hit.score
    })),
    symbols: search.symbols.map((symbol) => ({
      repoId: symbol.repoId,
      symbol: symbol.symbol,
      kind: symbol.kind,
      file: symbol.file,
      line: symbol.line,
      character: 0,
      displayName: symbol.displayName
    })),
    freshness: search.source,
    lastUpdated: new Date(),
    stale: false
  };
}
