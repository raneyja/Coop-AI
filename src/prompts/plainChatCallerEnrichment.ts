import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";
import { rankCodeDependentsByRisk } from "../engines/blastRadiusDependentsFallback";

const CALLERS_UNKNOWN_CLAIM =
  /\b(?:exact\s+)?callers?\s+(?:are\s+)?(?:not\s+)?(?:specified|unknown|unavailable|listed|clear)|(?:who\s+calls|callers?).{0,60}(?:not\s+(?:specified|known|listed|available)|unknown|unavailable)|(?:no|without)\s+(?:exact\s+)?caller/i;

function codeDependentDetailsFromEvidence(evidence: BlastRadiusEvidence) {
  if (evidence.dependentDetails?.length) {
    return evidence.dependentDetails.map((entry) => ({
      path: entry.path,
      depth: entry.depth,
      source: entry.source as "import-parse" | "scip" | "zoekt" | "remote" | "heuristic" | "workspace"
    }));
  }
  const source =
    (evidence.graphMeta?.source as
      | "import-parse"
      | "scip"
      | "zoekt"
      | "remote"
      | "heuristic"
      | "workspace"
      | undefined) ?? "remote";
  return (evidence.directDependents ?? []).map((path) => ({ path, depth: 1, source }));
}

export function plainChatClaimsCallersUnknown(content: string): boolean {
  return CALLERS_UNKNOWN_CLAIM.test(content);
}

/**
 * When plain chat asked who calls a file and durable dependents exist, ensure the
 * answer names them — never leave "callers unknown" while the import graph has hits.
 */
export function enrichPlainChatCallerResponse(
  content: string,
  evidence: BlastRadiusEvidence | undefined
): string {
  if (!evidence) {
    return content;
  }
  const details = codeDependentDetailsFromEvidence(evidence);
  const ranked = rankCodeDependentsByRisk(details, 8);
  if (ranked.length === 0) {
    return content;
  }

  const trimmed = content.trim();
  const claimsUnknown = plainChatClaimsCallersUnknown(trimmed);
  const missingTop = ranked.slice(0, 5).filter((entry) => !trimmed.includes(entry.path));
  if (missingTop.length === 0 && !claimsUnknown) {
    return content;
  }

  const source = evidence.graphMeta?.source ? ` (${evidence.graphMeta.source})` : "";
  const lines = ranked.slice(0, 8).map((entry) => `- \`${entry.path}\``);
  const lead = [
    `**Callers${source}**`,
    "",
    ...lines,
    "",
    claimsUnknown
      ? "Indexed import-graph callers are listed above — do not treat them as unknown."
      : "",
    ""
  ]
    .filter((line) => line !== "")
    .join("\n");

  // Keep a trailing blank line before the original answer for readability.
  return `${lead}\n\n${trimmed}`;
}
