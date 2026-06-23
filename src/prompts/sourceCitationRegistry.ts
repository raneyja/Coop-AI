/** Stable slug from a `[Sources: …]` label or inner text. */
export function sourceCitationSlug(label: string): string {
  const inner = extractSourceCitationInner(label);
  return inner
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** DOM id scoped to an evidence artifact turn. */
export function sourceCitationAnchor(artifactId: string, label: string): string {
  return `artifact-${artifactId}--${sourceCitationSlug(label)}`;
}

export function extractSourceCitationInner(label: string): string {
  let trimmed = label.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  const bracket = trimmed.match(/^\[Sources:\s*(.+?)\]$/i);
  if (bracket) {
    return bracket[1].trim();
  }
  return trimmed.replace(/^Sources:\s*/i, "").trim();
}

export function isSourceCitationLabel(text: string): boolean {
  return /^\[Sources:\s*.+\]$/i.test(text.trim());
}

export function normalizeSourceCitationLabel(text: string): string {
  const inner = extractSourceCitationInner(text);
  return `[Sources: ${inner}]`;
}

/** Fuzzy match when LLM slightly drifts from canonical labels. */
export function matchSourceCitationLabel(
  candidate: string,
  knownLabels: string[]
): string | undefined {
  const normalized = normalizeSourceCitationLabel(candidate);
  const exact = knownLabels.find((label) => normalizeSourceCitationLabel(label) === normalized);
  if (exact) {
    return exact;
  }
  const slug = sourceCitationSlug(normalized);
  return knownLabels.find((label) => sourceCitationSlug(label) === slug);
}
