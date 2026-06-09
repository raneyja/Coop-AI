import type { CodeHostProvider } from "./types";

export function buildExplorerFileSearchQuery(query: string, provider: CodeHostProvider): string {
  if (provider === "github") {
    if (query.includes("/")) {
      return `path:${query}`;
    }
    return `${query} in:path`;
  }
  return query;
}
