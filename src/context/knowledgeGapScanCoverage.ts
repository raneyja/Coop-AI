/**
 * Knowledge Gaps scan honesty: empty results are not a clean bill of health
 * unless the detector actually covered the repo.
 */

export type KnowledgeGapScanCoverage = "gaps_found" | "scan_incomplete" | "no_structured_gaps";

export type KnowledgeGapScanCoverageInput = {
  scanCoverage?: unknown;
  foundGaps?: number;
  gaps?: unknown[];
};

export function isKnowledgeGapScanCoverage(value: unknown): value is KnowledgeGapScanCoverage {
  return value === "gaps_found" || value === "scan_incomplete" || value === "no_structured_gaps";
}

export function isInfraDependencyGraphGap(gap: unknown): boolean {
  if (!gap || typeof gap !== "object") {
    return false;
  }
  const record = gap as { type?: unknown; message?: unknown };
  if (String(record.type ?? "") !== "impact_unknown") {
    return false;
  }
  return /no indexed dependency graph/i.test(String(record.message ?? ""));
}

export function knowledgeGapScanGapsWithoutInfra(gaps: unknown[] | undefined): unknown[] {
  if (!Array.isArray(gaps)) {
    return [];
  }
  return gaps.filter((gap) => !isInfraDependencyGraphGap(gap));
}

/**
 * Stale 7-day job cache without `scanCoverage` is incomplete, not healthy.
 * Infra "missing dependency graph" rows are not documentation gaps.
 * Remaining listed gaps still win as `gaps_found`.
 */
export function knowledgeGapScanCoverageFromJobScan(
  jobScan: KnowledgeGapScanCoverageInput | undefined
): KnowledgeGapScanCoverage | undefined {
  if (!jobScan) {
    return undefined;
  }
  const realGaps = knowledgeGapScanGapsWithoutInfra(jobScan.gaps);
  if (realGaps.length > 0) {
    return "gaps_found";
  }
  if (isKnowledgeGapScanCoverage(jobScan.scanCoverage)) {
    return jobScan.scanCoverage;
  }
  return "scan_incomplete";
}

export function knowledgeGapScanIncompleteCopy(target = "docs/owners"): string {
  return `This pass could not verify ${target} — the scan was incomplete, not a clean bill of health.`;
}

export function knowledgeGapScanCoverageAudienceLabel(
  coverage: KnowledgeGapScanCoverage | undefined
): string {
  if (coverage === "gaps_found") {
    return "Finished and found gaps";
  }
  if (coverage === "no_structured_gaps") {
    return "Finished with no listed gaps";
  }
  if (coverage === "scan_incomplete") {
    return "Did not finish — not a clean bill of health";
  }
  return "Status unknown";
}
