/** Product labels for quick_action.* usage events (matches extension QuickActionGrid). */
const QUICK_ACTION_LABELS: Record<string, string> = {
  understand_repo: "Understand Repo",
  trace_decision: "Trace Decision",
  find_owner: "Find Owner",
  blast_radius: "Blast Radius",
  knowledge_gaps: "Knowledge Gaps"
};

function suffixFromEventType(eventType: string): string {
  return eventType.replace(/^quick_action\./, "");
}

/** Human-readable quick action name for analytics charts and tables. */
export function quickActionLabelFromEventType(eventType: string): string {
  const suffix = suffixFromEventType(eventType);
  const mapped = QUICK_ACTION_LABELS[suffix];
  if (mapped) {
    return mapped;
  }
  // Legacy or unknown events: title-case token (e.g. "some_action" → "Some Action")
  return suffix
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
