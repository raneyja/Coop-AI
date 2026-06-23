/** Integration fetch payloads attached to Sources cards and synthesis checklists. */
export type IntegrationSearchEvidenceLike = {
  error?: string;
  messages?: unknown[];
  pages?: unknown[];
  issues?: unknown[];
  documents?: unknown[];
};

/** True when this integration was fetched and is connected (not a missing-credentials stub). */
export function isIntegrationConnectedForSources(
  evidence: IntegrationSearchEvidenceLike | undefined | null
): boolean {
  if (!evidence) {
    return false;
  }
  const error = evidence.error?.trim();
  if (!error) {
    return true;
  }
  return !isIntegrationNotConnectedError(error);
}

export function isIntegrationNotConnectedError(error: string): boolean {
  return (
    /not configured/i.test(error) ||
    /not connected/i.test(error) ||
    /credentials not configured/i.test(error)
  );
}

function integrationResultCount(evidence: IntegrationSearchEvidenceLike): number {
  return (
    (evidence.pages?.length ?? 0) +
    (evidence.issues?.length ?? 0) +
    (evidence.messages?.length ?? 0) +
    (evidence.documents?.length ?? 0)
  );
}

/** True when an integration should appear in prose **Sources** checklists (connected, succeeded, has hits). */
export function shouldIncludeIntegrationInSourcesChecklist(
  evidence: IntegrationSearchEvidenceLike | undefined | null
): boolean {
  if (!isIntegrationConnectedForSources(evidence) || evidence?.error?.trim()) {
    return false;
  }
  return integrationResultCount(evidence) > 0;
}
