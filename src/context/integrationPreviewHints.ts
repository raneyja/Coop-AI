/** Lightweight integration intent detectors for webview preview chips — no API client imports. */

export function previewWantsJiraContext(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (/\bjira\b/i.test(q)) return true;
  if (/\btickets?\b/i.test(q) && /\b(repo|repository|project|refer|related|link|this)\b/i.test(q)) {
    return true;
  }
  return /\b[A-Z][A-Z0-9]+-\d+\b/.test(q);
}

export function previewWantsSlackContext(query: string): boolean {
  const q = query.trim();
  return /\b(slack|channel|#general)\b/i.test(q);
}

export function previewWantsTeamsContext(query: string): boolean {
  return /\b(teams|microsoft teams)\b/i.test(query.trim());
}

export function previewWantsConfluenceContext(query: string): boolean {
  return /\bconfluence\b/i.test(query.trim());
}

export function previewWantsNotionContext(query: string): boolean {
  return /\bnotion\b/i.test(query.trim());
}

export function previewWantsGoogleDocsContext(query: string): boolean {
  return /\b(google docs?|gdoc)\b/i.test(query.trim());
}

export const INTEGRATION_PREVIEW_HINTS: Array<{
  id: string;
  label: string;
  detect: (query: string) => boolean;
}> = [
  { id: "jira", label: "Jira", detect: previewWantsJiraContext },
  { id: "slack", label: "Slack", detect: previewWantsSlackContext },
  { id: "teams", label: "Teams", detect: previewWantsTeamsContext },
  { id: "confluence", label: "Confluence", detect: previewWantsConfluenceContext },
  { id: "notion", label: "Notion", detect: previewWantsNotionContext },
  { id: "google-docs", label: "Google Docs", detect: previewWantsGoogleDocsContext }
];
