import type { Pool } from "pg";
import { CollectionStore } from "../server/collectionStore";
import { embedQuery } from "./embeddingsClient";
import { RepoEmbeddingsStore, type SimilarChunkHit } from "./repoEmbeddingsStore";

export type LightningSymbolHit = {
  repoId: string;
  symbol: string;
  kind: string;
  file: string;
  line: number;
  displayName: string;
};

export type LightningFileHit = {
  repoId: string;
  path: string;
  content: string;
  lineNumber: number;
  score: number;
};

export type LightningSearchResult = {
  source: "scip" | "embedding" | "fallback";
  symbols: LightningSymbolHit[];
  hits: LightningFileHit[];
};

export type LightningSearchOptions = {
  repoId?: string;
  collectionId?: string;
  pattern: string;
  limit?: number;
};

export async function lightningSearch(
  pool: Pool,
  orgId: string,
  repoIdOrOptions: string | LightningSearchOptions,
  patternArg?: string,
  limitArg = 20
): Promise<LightningSearchResult> {
  const options = normalizeSearchInput(repoIdOrOptions, patternArg, limitArg);
  const query = options.pattern.trim();
  const limit = options.limit ?? 20;
  if (!query) {
    return { source: "fallback", symbols: [], hits: [] };
  }

  const repoIds = await resolveSearchRepoIds(pool, orgId, options);
  if (repoIds.length === 0) {
    return { source: "fallback", symbols: [], hits: [] };
  }

  const symbols = await collectSymbolHits(pool, orgId, repoIds, query, limit);
  if (symbols.length > 0) {
    const hits = dedupeFileHits(
      symbols.map((symbol) => ({
        repoId: symbol.repoId,
        path: symbol.file,
        content: `${symbol.displayName} (${symbol.kind})`,
        lineNumber: symbol.line,
        score: 1
      }))
    );
    return { source: "scip", symbols, hits: hits.slice(0, limit) };
  }

  const embeddingStore = new RepoEmbeddingsStore(pool);
  const chunkCount = await embeddingStore.countChunksForRepos(orgId, repoIds);
  if (chunkCount === 0) {
    return { source: "fallback", symbols: [], hits: [] };
  }

  const queryEmbedding = await embedQuery(query);
  const similar = await collectSimilarHits(embeddingStore, orgId, repoIds, queryEmbedding, limit);
  if (similar.length === 0) {
    return { source: "fallback", symbols: [], hits: [] };
  }

  return {
    source: "embedding",
    symbols: [],
    hits: similar.map((hit) => ({
      repoId: hit.repoId,
      path: hit.filePath,
      content: hit.chunkText,
      lineNumber: hit.chunkIndex + 1,
      score: hit.score
    }))
  };
}

function normalizeSearchInput(
  repoIdOrOptions: string | LightningSearchOptions,
  patternArg?: string,
  limitArg = 20
): LightningSearchOptions & { limit: number } {
  if (typeof repoIdOrOptions === "string") {
    return {
      repoId: repoIdOrOptions,
      pattern: patternArg ?? "",
      limit: limitArg
    };
  }
  return {
    ...repoIdOrOptions,
    limit: repoIdOrOptions.limit ?? limitArg
  };
}

async function resolveSearchRepoIds(
  pool: Pool,
  orgId: string,
  options: LightningSearchOptions
): Promise<string[]> {
  if (options.collectionId) {
    return new CollectionStore(pool).listCollectionRepoIds(orgId, options.collectionId);
  }
  if (options.repoId) {
    return [options.repoId];
  }
  return [];
}

function perRepoLimit(limit: number, repoCount: number): number {
  return Math.max(3, Math.ceil(limit / repoCount));
}

async function collectSymbolHits(
  pool: Pool,
  orgId: string,
  repoIds: string[],
  query: string,
  limit: number
): Promise<LightningSymbolHit[]> {
  if (repoIds.length === 1) {
    return searchSymbolsAcrossRepos(pool, orgId, repoIds, query, limit);
  }

  const quota = perRepoLimit(limit, repoIds.length);
  const batches = await Promise.all(
    repoIds.map((repoId) => searchSymbolsAcrossRepos(pool, orgId, [repoId], query, quota))
  );
  return rankSymbolHits(batches.flat(), query).slice(0, limit);
}

async function collectSimilarHits(
  embeddingStore: RepoEmbeddingsStore,
  orgId: string,
  repoIds: string[],
  queryEmbedding: number[],
  limit: number
): Promise<SimilarChunkHit[]> {
  if (repoIds.length === 1) {
    return embeddingStore.searchSimilarAcrossRepos(orgId, repoIds, queryEmbedding, limit);
  }

  const quota = perRepoLimit(limit, repoIds.length);
  const batches = await Promise.all(
    repoIds.map((repoId) => embeddingStore.searchSimilar(orgId, repoId, queryEmbedding, quota))
  );
  return batches
    .flat()
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function rankSymbolHits(symbols: LightningSymbolHit[], query: string): LightningSymbolHit[] {
  const needle = query.toLowerCase();
  return symbols.sort((left, right) => {
    const leftRank = left.symbol.toLowerCase().includes(needle) ? 0 : 1;
    const rightRank = right.symbol.toLowerCase().includes(needle) ? 0 : 1;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.symbol.localeCompare(right.symbol);
  });
}

async function searchSymbolsAcrossRepos(
  pool: Pool,
  orgId: string,
  repoIds: string[],
  query: string,
  limit: number
): Promise<LightningSymbolHit[]> {
  const like = `%${escapeLike(query)}%`;
  const result = await pool.query<{
    repo_id: string;
    symbol: string;
    kind: string;
    file_path: string;
    line_start: number;
  }>(
    `SELECT repo_id, symbol, kind, file_path, line_start
     FROM repo_symbol_index
     WHERE org_id = $1
       AND repo_id = ANY($2::varchar[])
       AND (symbol ILIKE $3 OR file_path ILIKE $3)
     ORDER BY
       CASE WHEN symbol ILIKE $3 THEN 0 ELSE 1 END,
       symbol
     LIMIT $4`,
    [orgId, repoIds, like, limit]
  );

  return result.rows.map((row) => ({
    repoId: String(row.repo_id),
    symbol: String(row.symbol),
    kind: String(row.kind),
    file: String(row.file_path),
    line: Number(row.line_start),
    displayName: String(row.symbol)
  }));
}

function dedupeFileHits(hits: LightningFileHit[]): LightningFileHit[] {
  const seen = new Set<string>();
  const merged: LightningFileHit[] = [];
  for (const hit of hits) {
    const key = `${hit.repoId}:${hit.path}:${hit.lineNumber}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(hit);
  }
  return merged.sort((left, right) => right.score - left.score);
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}
