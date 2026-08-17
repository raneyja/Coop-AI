import type { LocalSearchResult, ScipSymbol, ZoektSearchHit } from "../../../indexing/types";
import { identifierSearchAliases } from "../searchQuery";
import type { AgentToolContext } from "../agentToolContext";
import { requireStringArg } from "./toolArgs";

function formatCitation(repoId: string, fileName: string, lineNumber: number): string {
  return `${repoId}:${fileName}:${lineNumber}`;
}

function mergeSearchResults(parts: LocalSearchResult[]): LocalSearchResult {
  const hits: ZoektSearchHit[] = [];
  const symbols: ScipSymbol[] = [];
  for (const part of parts) {
    for (const hit of part.hits) {
      if (!hits.some((seen) => seen.fileName === hit.fileName && seen.lineNumber === hit.lineNumber)) {
        hits.push(hit);
      }
    }
    for (const symbol of part.symbols) {
      if (!symbols.some((seen) => seen.file === symbol.file && seen.line === symbol.line && seen.symbol === symbol.symbol)) {
        symbols.push(symbol);
      }
    }
  }
  const first = parts[0];
  return {
    source: first?.source ?? "zoekt",
    stale: parts.some((part) => part.stale),
    hits,
    symbols
  };
}

export async function handleSearchCode(
  ctx: AgentToolContext,
  args: Record<string, unknown>
): Promise<string> {
  const query = requireStringArg(args, "query");
  const repoId =
    typeof args.repoId === "string" && args.repoId.trim() ? args.repoId.trim() : undefined;
  if (!repoId) {
    return JSON.stringify({ error: "Missing repoId for search_code" });
  }

  const enabled = await ctx.indexBackend.isEnabledForRepo(repoId);
  if (!enabled) {
    return JSON.stringify({
      error: `Lightning index is not enabled for ${repoId}`,
      query,
      repoId
    });
  }

  const queries = [query, ...identifierSearchAliases(query)].filter(
    (candidate, index, all) => all.findIndex((seen) => seen.toLowerCase() === candidate.toLowerCase()) === index
  );
  const parts: LocalSearchResult[] = [];
  for (const pattern of queries) {
    parts.push(await ctx.indexBackend.search(repoId, pattern));
  }
  const result = mergeSearchResults(parts);

  return JSON.stringify({
    repoId,
    query,
    queriesTried: queries,
    source: result.source,
    stale: result.stale,
    sampleNote:
      "search_code returns ranked hits from the index — not a complete file inventory or exhaustive match list.",
    hitCount: result.hits.length,
    hits: result.hits.map((hit) => ({
      citation: formatCitation(repoId, hit.fileName, hit.lineNumber),
      fileName: hit.fileName,
      lineNumber: hit.lineNumber,
      content: hit.content,
      score: hit.score
    })),
    symbols: result.symbols.map((symbol) => ({
      citation: formatCitation(repoId, symbol.file, symbol.line),
      symbol: symbol.symbol,
      kind: symbol.kind,
      file: symbol.file,
      line: symbol.line,
      displayName: symbol.displayName
    }))
  });
}
