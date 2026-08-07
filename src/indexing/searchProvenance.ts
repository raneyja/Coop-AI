export type SearchProvenance = "scip" | "zoekt" | "embedding" | "hybrid" | "fallback" | "workspace";

/** Map API/local freshness to LocalSearchResult.source. Never invent zoekt. */
export function mapSearchProvenance(
  freshness: string | undefined,
  options?: { hasHits?: boolean; hitSources?: Array<string | undefined> }
): "zoekt" | "scip" | "embedding" | "fallback" {
  if (
    freshness === "zoekt" ||
    freshness === "scip" ||
    freshness === "embedding" ||
    freshness === "fallback"
  ) {
    return freshness;
  }
  if (freshness === "hybrid") {
    return "zoekt";
  }

  const hitSources = options?.hitSources ?? [];
  const verified = hitSources.find((source) => source === "zoekt" || source === "scip");
  if (verified === "zoekt" || verified === "scip") {
    return verified;
  }

  if (options?.hasHits) {
    return "embedding";
  }

  return "fallback";
}
