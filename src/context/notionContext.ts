import { NotionClient } from "../api/notion/notionClient";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";
import { buildRepoOrQuery } from "./docSearchQuery";

export type NotionSearchPage = {
  id: string;
  title: string;
  updated: string;
  htmlUrl: string;
};

export type NotionSearchContext = {
  source: "notion-search";
  query: string;
  repoQuery?: string;
  pages: NotionSearchPage[];
  error?: string;
};

export function wantsNotionContext(query: string): boolean {
  const q = query.trim();
  if (!q) {
    return false;
  }
  if (/\bnotion\b/i.test(q)) {
    return true;
  }
  if (/\b(pages?|docs?|documentation)\b/i.test(q) && /\b(notion|repo|repository|this)\b/i.test(q)) {
    return true;
  }
  return false;
}

export function shouldFetchNotionContext(request: ContextFetchRequest): boolean {
  if (request.params.integrationProvider === "notion") {
    return true;
  }
  if (request.type !== "chat_context") {
    return false;
  }
  return wantsNotionContext(request.intent.context.queryText ?? "");
}

export async function fetchNotionSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  limit?: number;
}): Promise<NotionSearchContext> {
  const creds = await options.secrets.getCredentials();
  if (!creds.notionToken) {
    return {
      source: "notion-search",
      query: "",
      pages: [],
      error: "Notion integration token not configured."
    };
  }

  const query = buildRepoOrQuery(options.owner, options.repo);
  if (!query) {
    return {
      source: "notion-search",
      query: "",
      pages: [],
      error: "Set repository owner and repo in Settings to search Notion by repo."
    };
  }

  const client = new NotionClient({ token: creds.notionToken });
  try {
    const pages = await client.searchPages(query, options.limit ?? 20);
    const repoQuery =
      options.owner?.trim() && options.repo?.trim()
        ? `${options.owner.trim()}/${options.repo.trim()}`
        : options.repo?.trim();

    return {
      source: "notion-search",
      query,
      repoQuery,
      pages
    };
  } catch (error) {
    return {
      source: "notion-search",
      query,
      pages: [],
      error: error instanceof Error ? error.message : "Notion search failed."
    };
  }
}
