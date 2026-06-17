import type { Pool } from "pg";
import { parseRepoId } from "../server/gitCloneService";
import { CollectionStore } from "../server/collectionStore";
import { embedQuery } from "./embeddingsClient";
import { RepoEmbeddingsStore, type SimilarChunkHit } from "./repoEmbeddingsStore";

export type SearchHitSource = "scip" | "zoekt" | "embedding" | "fallback";

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
  source: SearchHitSource;
};

export type LightningSearchResult = {
  source: SearchHitSource | "hybrid";
  symbols: LightningSymbolHit[];
  hits: LightningFileHit[];
  zoektAvailable: boolean;
};

export type LightningSearchOptions = {
  repoId?: string;
  collectionId?: string;
  /** Cross-repo scope: workspace = user's selected repos; indexed/org = org catalog (legacy). */
  scope?: "workspace" | "indexed" | "org";
  /** When set, search is limited to these repo ids (user workspace selection). */
  userRepoIds?: string[];
  pattern: string;
  limit?: number;
  /** Path-focused search for @-mention picker (distinct files, no symbol/embedding noise). */
  mention?: boolean;
};

/**
 * Three-way parallel search: SCIP symbols + Zoekt full-text + semantic embeddings.
 *
 * All three run concurrently and the results are merged and ranked together.
 * This is better than a waterfall because:
 *  - SCIP finds exact compiler-derived symbols (functions, classes, types)
 *  - Zoekt finds any text pattern across every file (regex-grade full-text)
 *  - Embeddings find semantically related code even when terminology differs
 *
 * Source precedence for deduplication (when multiple sources hit the same file):
 *   scip > zoekt > embedding
 */
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
    return { source: "fallback", symbols: [], hits: [], zoektAvailable: false };
  }

  const repoIds = await resolveSearchRepoIds(pool, orgId, options);
  if (repoIds.length === 0) {
    return { source: "fallback", symbols: [], hits: [], zoektAvailable: false };
  }

  if (options.mention) {
    const pathHits = await collectMentionPathHits(pool, orgId, repoIds, query, limit * 2);
    const zoektHits = query.includes("/")
      ? await collectZoektMentionHits(query, repoIds, limit)
      : [];
    const minScore = mentionPathMinScore(query);
    const hits = rankMentionPathHits(
      [...pathHits, ...zoektHits].filter(
        (hit) => !isNoisyMentionPath(hit.path) && scoreMentionPath(hit.path, query) >= minScore
      ),
      query,
      limit
    );
    return {
      source:
        hits.length > 0
          ? pathHits.length > 0 && zoektHits.length > 0
            ? "hybrid"
            : pathHits.length > 0
              ? "scip"
              : "zoekt"
          : "fallback",
      symbols: [],
      hits,
      zoektAvailable: zoektHits.length > 0 || Boolean(process.env.ZOEKT_URL)
    };
  }

  // Run all three search strategies in parallel — never wait for one to fail before trying another.
  const [scipOutcome, zoektOutcome, embeddingOutcome] = await Promise.allSettled([
    collectSymbolHits(pool, orgId, repoIds, query, limit * 2),
    collectZoektHits(query, repoIds, limit * 2),
    collectEmbeddingHits(pool, orgId, repoIds, query, limit)
  ]);

  const symbols = scipOutcome.status === "fulfilled" ? scipOutcome.value : [];
  const zoektHits = zoektOutcome.status === "fulfilled" ? zoektOutcome.value : [];
  const embeddingHits = embeddingOutcome.status === "fulfilled" ? embeddingOutcome.value : [];
  const zoektAvailable = zoektHits.length > 0 || Boolean(process.env.ZOEKT_URL);

  // Symbol hits → file hits (keep symbols separate for structured display)
  const scipFileHits: LightningFileHit[] = symbols.map((sym) => ({
    repoId: sym.repoId,
    path: sym.file,
    content: `${sym.displayName} (${sym.kind})`,
    lineNumber: sym.line,
    score: 1.0,
    source: "scip" as SearchHitSource
  }));

  // Merge all file hits and rank: SCIP (1.0) > Zoekt (0.85+) > embedding (cosine score)
  const allHits = mergeAndRankHits([...scipFileHits, ...zoektHits, ...embeddingHits], limit);

  const activeSources = new Set<SearchHitSource>(allHits.map((h) => h.source));
  const aggregateSource: LightningSearchResult["source"] =
    activeSources.size > 1
      ? "hybrid"
      : activeSources.has("scip")
        ? "scip"
        : activeSources.has("zoekt")
          ? "zoekt"
          : activeSources.has("embedding")
            ? "embedding"
            : "fallback";

  return {
    source: aggregateSource,
    symbols,
    hits: allHits,
    zoektAvailable
  };
}

// ---------------------------------------------------------------------------
// Zoekt HTTP client
// ---------------------------------------------------------------------------

type ZoektFileMatch = {
  FileName: string;
  Repo?: string;
  Repository?: string;
  Matches?: Array<{
    LineNum?: number;
    LineNumber?: number;
    Line?: string;
    Score?: number;
    Fragments?: Array<{ Pre?: string; Match?: string; Post?: string }>;
  }>;
  Score?: number;
};

type ZoektSearchResponse = {
  result?: {
    FileMatches?: ZoektFileMatch[];
  };
  Result?: {
    Files?: ZoektFileMatch[];
  };
};

async function collectZoektHits(
  query: string,
  repoIds: string[],
  limit: number
): Promise<LightningFileHit[]> {
  const zoektUrl = process.env.ZOEKT_URL;
  if (!zoektUrl) {
    return [];
  }

  try {
    const scopedQuery = buildZoektScopedQuery(query, repoIds);
    const url = new URL("/search", zoektUrl.replace(/\/$/, "") + "/");
    url.searchParams.set("q", scopedQuery);
    url.searchParams.set("format", "json");
    url.searchParams.set("num", String(Math.max(limit * 2, 20)));

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8_000)
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as ZoektSearchResponse;
    const files = data.result?.FileMatches ?? data.Result?.Files ?? [];
    const hits: LightningFileHit[] = [];

    for (const file of files) {
      const repoName = file.Repo ?? file.Repository;
      const matches =
        file.Matches ??
        [{ LineNumber: 1, Line: file.FileName, LineNum: 1 }];
      for (const match of matches) {
        const fragmentText = match.Fragments?.map((part) => part.Match ?? "").join("") ?? "";
        const rawScore = match.Score ?? file.Score ?? 1;
        const normalizedScore = Math.min(0.95, 0.5 + rawScore / 200);
        const lineNumber = match.LineNum ?? match.LineNumber ?? 1;

        hits.push({
          repoId: repoIdFromZoektRepo(repoName, repoIds),
          path: file.FileName,
          content: fragmentText || match.Line || file.FileName,
          lineNumber,
          score: normalizedScore,
          source: "zoekt"
        });
      }
      if (hits.length >= limit * 2) {
        break;
      }
    }

    return hits;
  } catch {
    return [];
  }
}

function buildZoektRepoFilter(repoIds: string[]): string {
  if (repoIds.length === 0) {
    return "";
  }
  const repoNames = repoIds.map((repoId) => zoektRepoName(repoId));
  return repoNames.length === 1
    ? `repo:${quoteZoektToken(repoNames[0])}`
    : `(${repoNames.map((name) => `repo:${quoteZoektToken(name)}`).join(" or ")})`;
}

function buildZoektScopedQuery(query: string, repoIds: string[]): string {
  const repoFilter = buildZoektRepoFilter(repoIds);
  if (!repoFilter) {
    return query;
  }
  return `${repoFilter} ${query}`.trim();
}

async function collectZoektMentionHits(
  pathQuery: string,
  repoIds: string[],
  limit: number
): Promise<LightningFileHit[]> {
  const repoFilter = buildZoektRepoFilter(repoIds);
  if (!repoFilter) {
    return [];
  }
  const fileFilter = `file:${quoteZoektToken(pathQuery.trim())}`;
  return collectZoektHits(`${repoFilter} ${fileFilter}`.trim(), repoIds, limit);
}

async function collectMentionPathHits(
  pool: Pool,
  orgId: string,
  repoIds: string[],
  query: string,
  limit: number
): Promise<LightningFileHit[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const isDirectoryQuery = !trimmed.includes("/");
  const likePrefix = `${escapeLike(trimmed)}%`;
  const likeDirPrefix = `${escapeLike(trimmed)}/%`;
  const likeDirSegment = `%/${escapeLike(trimmed)}/%`;

  const result = await pool.query<{ repo_id: string; file_path: string }>(
    isDirectoryQuery
      ? `SELECT DISTINCT repo_id, file_path
         FROM repo_symbol_index
         WHERE org_id = $1
           AND repo_id = ANY($2::varchar[])
           AND (
             file_path ILIKE $3
             OR file_path ILIKE $4
             OR file_path = $5
           )`
      : `SELECT DISTINCT repo_id, file_path
         FROM repo_symbol_index
         WHERE org_id = $1
           AND repo_id = ANY($2::varchar[])
           AND (
             file_path ILIKE $3
             OR file_path ILIKE $4
             OR file_path = $5
             OR file_path ILIKE $6
           )`,
    isDirectoryQuery
      ? [orgId, repoIds, likeDirPrefix, likeDirSegment, trimmed]
      : [
          orgId,
          repoIds,
          `%${escapeLike(trimmed)}%`,
          likePrefix,
          trimmed,
          `%/${escapeLike(trimmed.split("/").pop() ?? trimmed)}`
        ]
  );

  return result.rows
    .filter((row) => !isNoisyMentionPath(String(row.file_path)))
    .map((row) => ({
      repoId: String(row.repo_id),
      path: String(row.file_path),
      content: String(row.file_path),
      lineNumber: 1,
      score: scoreMentionPath(String(row.file_path), trimmed) / 100,
      source: "scip" as SearchHitSource
    }))
    .filter((hit) => hit.score > 0)
    .sort(
      (left, right) =>
        scoreMentionPath(right.path, trimmed) - scoreMentionPath(left.path, trimmed) ||
        left.path.localeCompare(right.path)
    )
    .slice(0, limit);
}

function mentionPathMinScore(query: string): number {
  return query.includes("/") ? 50 : 70;
}

function rankMentionPathHits(hits: LightningFileHit[], query: string, limit: number): LightningFileHit[] {
  const byPath = new Map<string, LightningFileHit>();
  for (const hit of hits) {
    const key = `${hit.repoId}:${hit.path}`;
    const existing = byPath.get(key);
    if (!existing || scoreMentionPath(hit.path, query) > scoreMentionPath(existing.path, query)) {
      byPath.set(key, hit);
    }
  }
  return [...byPath.values()]
    .sort(
      (left, right) =>
        scoreMentionPath(right.path, query) - scoreMentionPath(left.path, query) ||
        left.path.localeCompare(right.path)
    )
    .slice(0, limit);
}

function isNoisyMentionPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    normalized.startsWith("testdata/") ||
    normalized.includes("/testdata/") ||
    normalized.includes("/shards/") ||
    normalized.endsWith(".zoekt") ||
    normalized.endsWith(".pb") ||
    normalized.includes("/vendor/") ||
    normalized.includes("/node_modules/")
  );
}

function scoreMentionPath(filePath: string, query: string): number {
  const path = filePath.toLowerCase();
  const needle = query.toLowerCase();
  if (path === needle) {
    return 100;
  }
  if (path.startsWith(`${needle}/`) || path.startsWith(needle)) {
    return 95;
  }
  if (path.endsWith(`/${needle}`) || path.endsWith(needle)) {
    return 90;
  }

  const queryParts = needle.split("/").filter(Boolean);
  const pathParts = path.split("/");
  let pathIdx = 0;
  let matchedSegments = 0;
  for (const part of queryParts) {
    while (pathIdx < pathParts.length) {
      const segment = pathParts[pathIdx];
      if (segment === part || segment.includes(part) || part.includes(segment)) {
        matchedSegments += 1;
        pathIdx += 1;
        break;
      }
      pathIdx += 1;
    }
  }
  if (queryParts.length > 0 && matchedSegments === queryParts.length) {
    return 75 + matchedSegments * 5;
  }

  if (path.includes(needle)) {
    return 50;
  }

  const queryBase = queryParts[queryParts.length - 1] ?? needle;
  const pathBase = pathParts[pathParts.length - 1] ?? "";
  if (pathBase === queryBase) {
    return 60;
  }
  if (pathBase.startsWith(queryBase)) {
    return 55;
  }

  return 0;
}

function zoektRepoName(repoId: string): string {
  const { provider, owner, repo } = parseRepoId(repoId);
  if (provider === "gitlab") {
    return `gitlab.com/${owner}/${repo}`;
  }
  if (provider === "bitbucket") {
    return `bitbucket.org/${owner}/${repo}`;
  }
  return `github.com/${owner}/${repo}`;
}

function quoteZoektToken(value: string): string {
  return value.includes(" ") ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function repoIdFromZoektRepo(repository: string | undefined, repoIds: string[]): string {
  if (!repository) {
    return repoIds[0] ?? "";
  }
  const normalizedRepo = repository.toLowerCase();
  const exact = repoIds.find((id) => zoektRepoName(id).toLowerCase() === normalizedRepo);
  if (exact) {
    return exact;
  }
  const match = repoIds.find((id) => {
    const zoektName = zoektRepoName(id).toLowerCase();
    return (
      normalizedRepo === zoektName ||
      normalizedRepo.endsWith(`/${zoektName.split("/").slice(-2).join("/")}`) ||
      id.toLowerCase().includes(normalizedRepo.replace(/^github\.com\//, ""))
    );
  });
  return match ?? repoIds[0] ?? "";
}

// ---------------------------------------------------------------------------
// SCIP symbol search
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Embedding search
// ---------------------------------------------------------------------------

async function collectEmbeddingHits(
  pool: Pool,
  orgId: string,
  repoIds: string[],
  query: string,
  limit: number
): Promise<LightningFileHit[]> {
  const embeddingStore = new RepoEmbeddingsStore(pool);
  const chunkCount = await embeddingStore.countChunksForRepos(orgId, repoIds);
  if (chunkCount === 0) {
    return [];
  }

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embedQuery(query);
  } catch {
    return [];
  }

  const similar = await collectSimilarHits(embeddingStore, orgId, repoIds, queryEmbedding, limit);

  return similar.map((hit) => ({
    repoId: hit.repoId,
    path: hit.filePath,
    content: hit.chunkText,
    lineNumber: hit.chunkIndex + 1,
    score: hit.score,
    source: "embedding" as SearchHitSource
  }));
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

// ---------------------------------------------------------------------------
// Merge & rank
// ---------------------------------------------------------------------------

/**
 * Merge hits from all three sources into a single ranked list.
 *
 * Deduplication: when multiple sources hit the same file path, we keep the hit
 * from the highest-priority source (scip > zoekt > embedding) and carry its
 * score. This ensures SCIP compiler-derived matches always win over fuzzy text
 * or semantic matches for the same file.
 */
function mergeAndRankHits(hits: LightningFileHit[], limit: number): LightningFileHit[] {
  const sourcePriority: Record<SearchHitSource, number> = {
    scip: 3,
    zoekt: 2,
    embedding: 1,
    fallback: 0
  };

  // Per file: keep the hit from the highest-priority source
  const byPath = new Map<string, LightningFileHit>();

  for (const hit of hits) {
    const key = `${hit.repoId}:${hit.path}`;
    const existing = byPath.get(key);
    if (!existing) {
      byPath.set(key, hit);
      continue;
    }
    const existingPriority = sourcePriority[existing.source];
    const hitPriority = sourcePriority[hit.source];
    if (hitPriority > existingPriority || (hitPriority === existingPriority && hit.score > existing.score)) {
      byPath.set(key, hit);
    }
  }

  return Array.from(byPath.values())
    .sort((left, right) => {
      // Sort by source priority first, then score
      const priorityDiff = sourcePriority[right.source] - sourcePriority[left.source];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return right.score - left.score;
    })
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSearchInput(
  repoIdOrOptions: string | LightningSearchOptions,
  patternArg?: string,
  limitArg = 20
): LightningSearchOptions & { limit: number } {
  if (typeof repoIdOrOptions === "string") {
    return { repoId: repoIdOrOptions, pattern: patternArg ?? "", limit: limitArg };
  }
  return { ...repoIdOrOptions, limit: repoIdOrOptions.limit ?? limitArg };
}

export async function resolveSearchRepoIds(
  pool: Pool,
  orgId: string,
  options: LightningSearchOptions
): Promise<string[]> {
  if (options.userRepoIds?.length) {
    return options.userRepoIds;
  }
  if (options.collectionId) {
    return new CollectionStore(pool).listCollectionRepoIds(orgId, options.collectionId);
  }
  if (options.scope === "workspace") {
    return [];
  }
  if (options.scope === "indexed" || options.scope === "org") {
    const result = await pool.query<{ repo_id: string }>(
      `SELECT repo_id FROM org_repos WHERE org_id = $1 AND lightning_enabled = true ORDER BY repo_id`,
      [orgId]
    );
    return result.rows.map((row) => String(row.repo_id));
  }
  if (options.repoId) {
    return [options.repoId];
  }
  return [];
}

function perRepoLimit(limit: number, repoCount: number): number {
  return Math.max(3, Math.ceil(limit / repoCount));
}

function rankSymbolHits(symbols: LightningSymbolHit[], query: string): LightningSymbolHit[] {
  const needle = query.toLowerCase();
  return symbols.sort((left, right) => {
    const leftRank = left.symbol.toLowerCase().startsWith(needle)
      ? 0
      : left.symbol.toLowerCase().includes(needle)
        ? 1
        : 2;
    const rightRank = right.symbol.toLowerCase().startsWith(needle)
      ? 0
      : right.symbol.toLowerCase().includes(needle)
        ? 1
        : 2;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.symbol.localeCompare(right.symbol);
  });
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}
