import type { Pool } from "pg";
import { embedQuery } from "./embeddingsClient";
import { RepoEmbeddingsStore } from "./repoEmbeddingsStore";

export type LightningSymbolHit = {
  symbol: string;
  kind: string;
  file: string;
  line: number;
  displayName: string;
};

export type LightningFileHit = {
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

export async function lightningSearch(
  pool: Pool,
  orgId: string,
  repoId: string,
  pattern: string,
  limit = 20
): Promise<LightningSearchResult> {
  const query = pattern.trim();
  if (!query) {
    return { source: "fallback", symbols: [], hits: [] };
  }

  const symbols = await searchSymbols(pool, orgId, repoId, query, limit);
  if (symbols.length > 0) {
    const hits = dedupeFileHits(
      symbols.map((symbol) => ({
        path: symbol.file,
        content: `${symbol.displayName} (${symbol.kind})`,
        lineNumber: symbol.line,
        score: 1
      }))
    );
    return { source: "scip", symbols, hits };
  }

  const embeddingStore = new RepoEmbeddingsStore(pool);
  const chunkCount = await embeddingStore.countChunks(orgId, repoId);
  if (chunkCount === 0) {
    return { source: "fallback", symbols: [], hits: [] };
  }

  const queryEmbedding = await embedQuery(query);
  const similar = await embeddingStore.searchSimilar(orgId, repoId, queryEmbedding, limit);
  if (similar.length === 0) {
    return { source: "fallback", symbols: [], hits: [] };
  }

  return {
    source: "embedding",
    symbols: [],
    hits: similar.map((hit) => ({
      path: hit.filePath,
      content: hit.chunkText,
      lineNumber: hit.chunkIndex + 1,
      score: hit.score
    }))
  };
}

async function searchSymbols(
  pool: Pool,
  orgId: string,
  repoId: string,
  query: string,
  limit: number
): Promise<LightningSymbolHit[]> {
  const like = `%${escapeLike(query)}%`;
  const result = await pool.query<{
    symbol: string;
    kind: string;
    file_path: string;
    line_start: number;
  }>(
    `SELECT symbol, kind, file_path, line_start
     FROM repo_symbol_index
     WHERE org_id = $1
       AND repo_id = $2
       AND (symbol ILIKE $3 OR file_path ILIKE $3)
     ORDER BY
       CASE WHEN symbol ILIKE $3 THEN 0 ELSE 1 END,
       symbol
     LIMIT $4`,
    [orgId, repoId, like, limit]
  );

  return result.rows.map((row) => ({
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
    const key = `${hit.path}:${hit.lineNumber}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(hit);
  }
  return merged;
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}
