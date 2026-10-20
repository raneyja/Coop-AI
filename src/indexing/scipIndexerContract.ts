export function buildGoScipArgs(_root: string, out: string): string[] {
  return ["index", "--output", out, "./..."];
}

export function requireNonEmptyScipAnalysis(symbolCount: number): void {
  if (!Number.isInteger(symbolCount) || symbolCount <= 0) {
    throw new Error("SCIP indexing completed without producing any symbols.");
  }
}
