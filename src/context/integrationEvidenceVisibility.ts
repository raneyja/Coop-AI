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
): evidence is IntegrationSearchEvidenceLike {
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

function openedHitText(item: unknown): string {
  if (!item || typeof item !== "object") {
    return "";
  }
  const rec = item as Record<string, unknown>;
  for (const key of ["description", "excerpt", "text", "body"] as const) {
    const value = rec[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function integrationOpenedHitCount(evidence: IntegrationSearchEvidenceLike): number {
  const buckets = [evidence.pages, evidence.issues, evidence.messages, evidence.documents];
  let count = 0;
  for (const bucket of buckets) {
    for (const item of bucket ?? []) {
      if (openedHitText(item)) {
        count += 1;
      }
    }
  }
  return count;
}

/** Sources cards: connected, succeeded, and has opened content. Title-only rows stay in Activity. */
export function shouldIncludeIntegrationInSourcesChecklist(
  evidence: IntegrationSearchEvidenceLike | undefined | null
): evidence is IntegrationSearchEvidenceLike {
  if (!evidence || !isIntegrationConnectedForSources(evidence) || evidence.error?.trim()) {
    return false;
  }
  return integrationOpenedHitCount(evidence) > 0;
}
