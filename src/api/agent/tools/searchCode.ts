import type { AgentToolContext } from "../agentToolContext";
import { requireStringArg } from "./toolArgs";

function formatCitation(repoId: string, fileName: string, lineNumber: number): string {
  return `${repoId}:${fileName}:${lineNumber}`;
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

  const result = await ctx.indexBackend.search(repoId, query);
  return JSON.stringify({
    repoId,
    query,
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
