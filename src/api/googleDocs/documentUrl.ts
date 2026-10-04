/** Only canonical Google Docs document URLs identify a direct body read. */
export function googleDocumentIdFromText(text: string): string | undefined {
  const ids = new Set<string>();
  for (const match of text.matchAll(/https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)(?=[/?#\s.)]|$)/g)) {
    ids.add(match[1]!);
  }
  return ids.size === 1 ? [...ids][0] : undefined;
}
