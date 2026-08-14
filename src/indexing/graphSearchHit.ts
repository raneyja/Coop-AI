/**
 * Wire shape of `/graph/{repoId}/search` and how it maps to a search hit.
 *
 * One mapper for every caller. When this logic was copy-pasted, both copies
 * invented match positions and both fed the wrong lines to the model.
 * Kept free of `vscode` so the contract is testable on its own.
 */
import { mapSearchProvenance } from "./searchProvenance";
import type { LocalSearchResult } from "./types";

export type GraphSearchHitRecord = {
  path: string;
  size?: number;
  content?: string;
  source?: string;
  repoId?: string;
  score?: number;
  /** Real match line. `sha` is the legacy carrier from the file-listing shape. */
  line?: number;
  lineNumber?: number;
  sha?: string;
};

export type GraphSearchSymbolRecord = {
  symbol?: string;
  kind?: string;
  file?: string;
  line?: number;
  displayName?: string;
};

export type GraphSearchResponse = {
  data?: GraphSearchHitRecord[];
  symbols?: GraphSearchSymbolRecord[];
  freshness?: string;
  stale?: boolean;
};

/** Not a valid 1-based line — means "the index did not tell us where the match is". */
export const UNKNOWN_HIT_LINE = 0;

/**
 * Match line, or {@link UNKNOWN_HIT_LINE} when the server did not send one.
 * Never invent a position: callers window around it, read the wrong lines, and
 * answer from them.
 */
export function remoteHitLine(record: GraphSearchHitRecord): number {
  for (const candidate of [record.line, record.lineNumber, Number(record.sha)]) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return UNKNOWN_HIT_LINE;
}

/**
 * The only place a `/graph/…/search` response becomes a search result.
 * Scores and positions come from the index; nothing here is invented.
 */
export function mapGraphSearchResponse(remote: GraphSearchResponse): LocalSearchResult {
  const hits = (remote.data ?? [])
    .filter((record) => record.path?.trim())
    .map((record) => {
      const fileName = record.path.trim();
      const content =
        typeof record.content === "string" && record.content.trim() ? record.content : fileName;
      return {
        fileName,
        repoId: record.repoId,
        lineNumber: remoteHitLine(record),
        content,
        score: typeof record.score === "number" ? record.score : 0,
        source: hitSource(record.source, remote.freshness)
      };
    });

  const symbols = (remote.symbols ?? [])
    .filter((record) => record.file?.trim())
    .map((record) => ({
      symbol: record.symbol ?? "",
      kind: record.kind ?? "",
      file: record.file!.trim(),
      line: typeof record.line === "number" && record.line > 0 ? record.line : UNKNOWN_HIT_LINE,
      character: 0,
      displayName: record.displayName ?? record.symbol ?? ""
    }));

  return {
    source: mapSearchProvenance(remote.freshness, {
      hasHits: hits.length > 0,
      hitSources: hits.map((hit) => hit.source)
    }),
    hits,
    symbols,
    stale: Boolean(remote.stale)
  };
}

function hitSource(
  source: string | undefined,
  freshness: string | undefined
): LocalSearchResult["source"] {
  if (source === "zoekt" || source === "scip" || source === "embedding" || source === "fallback") {
    return source;
  }
  return mapSearchProvenance(freshness);
}
