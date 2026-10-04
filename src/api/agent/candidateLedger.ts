/** Turn-owned retrieval memory. Filename candidates are never evidence by themselves. */
export type CandidateStatus = "untested" | "verified" | "ruled_out" | "unavailable";
export type CandidateRecord = { path: string; criterion: string; status: CandidateStatus };

export function canonicalSearchCriterion(query: string): string {
  return query.trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export class CandidateLedger {
  private readonly requests = new Map<string, Promise<unknown>>();
  private readonly candidates = new Map<string, CandidateRecord>();

  /** Failed requests remain unavailable for this turn; a new turn gets a fresh ledger. */
  public once<T>(kind: string, repoId: string, criterion: string, run: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([kind, repoId, (kind === "body" || kind === "verify" || kind.endsWith("-literal")) ? criterion : canonicalSearchCriterion(criterion)]);
    let pending = this.requests.get(key);
    if (!pending) {
      pending = Promise.resolve().then(run);
      this.requests.set(key, pending);
    }
    return pending as Promise<T>;
  }

  public record(repoId: string, path: string, criterion: string, status: CandidateStatus): void {
    const normalized = canonicalSearchCriterion(criterion);
    const key = JSON.stringify([repoId, path, normalized]);
    if (status === "untested" && this.candidates.has(key)) return;
    this.candidates.set(key, { path, criterion: normalized, status });
  }

  public snapshot(repoId: string): CandidateRecord[] {
    return [...this.candidates.entries()].filter(([key]) => JSON.parse(key)[0] === repoId)
      .map(([, record]) => ({ ...record }));
  }
}
