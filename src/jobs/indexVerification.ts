/**
 * Post-index acceptance: Ready only when at least one durable signal exists.
 * Prevents "Ready but empty" for remote customer users.
 */
export type IndexVerificationInput = {
  fileCount: number;
  symbolCount: number;
  zoektAvailable: boolean;
};

export type IndexVerificationResult =
  | { ok: true }
  | { ok: false; message: string };

export function verifyIndexArtifacts(input: IndexVerificationInput): IndexVerificationResult {
  const fileCount = Math.max(0, input.fileCount);
  const symbolCount = Math.max(0, input.symbolCount);
  if (fileCount > 0 || symbolCount > 0 || input.zoektAvailable) {
    return { ok: true };
  }
  return {
    ok: false,
    message:
      "Deep-Index finished but produced no searchable artifacts " +
      "(no inventory files, no symbols, and Zoekt unavailable). Reindex after checking worker env and GitHub App access."
  };
}
