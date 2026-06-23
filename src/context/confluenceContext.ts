import { ConfluenceClient } from "../api/confluence/confluenceClient";
import {
  confluenceSiteUrlError,
  resolveConfluenceAuth,
  resolveConfluenceBaseUrl
} from "../api/confluence/resolveConfluenceBaseUrl";
import { createConfluenceClientFromCredentials } from "../api/integrations/buildIntegrationClients";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";
import { buildConfluenceCql, buildRepoOrQuery } from "./docSearchQuery";
import { shouldFetchRepoWideIntegrations } from "./integrationFetchPolicy";

export type ConfluenceSearchPage = {
  id: string;
  title: string;
  excerpt?: string;
  updated: string;
  htmlUrl: string;
};

export type ConfluenceSearchContext = {
  source: "confluence-search";
  cql: string;
  repoQuery?: string;
  pages: ConfluenceSearchPage[];
  error?: string;
};

export function wantsConfluenceContext(query: string): boolean {
  const q = query.trim();
  if (!q) {
    return false;
  }
  if (/\bconfluence\b/i.test(q)) {
    return true;
  }
  if (/\b(pages?|docs?|documentation|wiki)\b/i.test(q) && /\b(confluence|repo|repository|this)\b/i.test(q)) {
    return true;
  }
  return false;
}

export function shouldFetchConfluenceContext(request: ContextFetchRequest): boolean {
  if (request.params.integrationProvider === "confluence") {
    return true;
  }
  if (shouldFetchRepoWideIntegrations(request)) {
    return true;
  }
  if (request.type !== "chat_context") {
    return false;
  }
  return wantsConfluenceContext(request.intent.context.queryText ?? "");
}

export async function fetchConfluenceSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  limit?: number;
}): Promise<ConfluenceSearchContext> {
  const creds = await options.secrets.getCredentials();
  const auth = resolveConfluenceAuth(creds);
  if (!auth && !creds.atlassianCloudId) {
    return {
      source: "confluence-search",
      cql: "",
      pages: [],
      error: "Confluence credentials not configured."
    };
  }

  const cql = buildConfluenceCql(options.owner, options.repo);
  if (!cql) {
    return {
      source: "confluence-search",
      cql: "",
      pages: [],
      error: "Set repository owner and repo in Settings to search Confluence by repo."
    };
  }

  const { baseUrl } = resolveConfluenceBaseUrl({
    confluenceBaseUrl: creds.confluenceBaseUrl,
    jiraBaseUrl: creds.jiraBaseUrl
  });
  const siteError = confluenceSiteUrlError(baseUrl);
  if (siteError && !creds.atlassianCloudId) {
    return {
      source: "confluence-search",
      cql,
      pages: [],
      error: siteError
    };
  }

  const oauthClient = createConfluenceClientFromCredentials(creds, baseUrl);
  const client =
    oauthClient ??
    (auth
      ? new ConfluenceClient({
          baseUrl,
          email: auth.email,
          apiToken: auth.apiToken
        })
      : undefined);
  if (!client) {
    return {
      source: "confluence-search",
      cql,
      pages: [],
      error: "Confluence credentials not configured."
    };
  }

  try {
    const pages = await client.searchPages(cql, options.limit ?? 20);
    const repoQuery =
      options.owner?.trim() && options.repo?.trim()
        ? `${options.owner.trim()}/${options.repo.trim()}`
        : options.repo?.trim();

    return {
      source: "confluence-search",
      cql,
      repoQuery,
      pages: pages.map((page) => ({
        id: page.id,
        title: page.title,
        excerpt: page.excerpt ? truncate(page.excerpt, 300) : undefined,
        updated: page.updated,
        htmlUrl: page.htmlUrl
      }))
    };
  } catch (error) {
    return {
      source: "confluence-search",
      cql,
      pages: [],
      error: error instanceof Error ? error.message : "Confluence search failed."
    };
  }
}

export function confluenceFallbackQuery(owner?: string, repo?: string): string | undefined {
  return buildRepoOrQuery(owner, repo);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}
