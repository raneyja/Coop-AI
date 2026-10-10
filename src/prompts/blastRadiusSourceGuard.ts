import type { BlastRadiusEvidence } from "../context/contextBundleEvidence";
import { verifySourceCitationQuotes, type ReviewedSourceWindow } from "./sourceCitationIntegrity";

/** Source identity belongs to the frozen Blast evidence; matching source bytes
 * belongs to the shared integrity owner. Neither certifies behavioral prose. */
export function validateBlastSourceCitations(content: string, evidence: BlastRadiusEvidence) {
  const sources = evidence.sourceFiles ?? [];
  const identities = new Set(sources.map(source => source.repoId + "\0" + (source.branch ?? "")));
  const pathCounts = new Map<string, number>();
  for (const source of sources) pathCounts.set(source.path, (pathCounts.get(source.path) ?? 0) + 1);
  const unambiguous = identities.size === 1 && sources.every(source => Boolean(source.repoId))
    ? sources.filter(source => pathCounts.get(source.path) === 1)
    : [];
  const windows: ReviewedSourceWindow[] = unambiguous.map(({ path, content, startLine }) => ({ path, content, startLine }));
  const checked = verifySourceCitationQuotes(content, windows);
  return { content: checked.content, verifiedCount: checked.verifiedQuotes, invalidCount: checked.invalidQuotes, windows };
}

/** Final source quotes use the same validator as the private synthesis gate. */
export function groundBlastSourceCitations(content: string, evidence: BlastRadiusEvidence): string {
  return validateBlastSourceCitations(content, evidence).content;
}
