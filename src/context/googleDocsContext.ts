import { GoogleDocsClient } from "../api/googleDocs/googleDocsClient";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";
import { buildRepoOrQuery } from "./docSearchQuery";

export type GoogleDocsSearchPage = {
  id: string;
  title: string;
  updated: string;
  htmlUrl: string;
};

export type GoogleDocsSearchContext = {
  source: "google-docs-search";
  query: string;
  repoQuery?: string;
  documents: GoogleDocsSearchPage[];
  error?: string;
};

export function wantsGoogleDocsContext(query: string): boolean {
  const q = query.trim();
  if (!q) {
    return false;
  }
  if (/\bgoogle docs?\b/i.test(q)) {
    return true;
  }
  if (/\b(docs?|documents?|documentation)\b/i.test(q) && /\b(google|repo|repository|this)\b/i.test(q)) {
    return true;
  }
  return false;
}

export function shouldFetchGoogleDocsContext(request: ContextFetchRequest): boolean {
  if (request.params.integrationProvider === "google-docs") {
    return true;
  }
  if (request.type !== "chat_context") {
    return false;
  }
  return wantsGoogleDocsContext(request.intent.context.queryText ?? "");
}

export async function fetchGoogleDocsSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  limit?: number;
}): Promise<GoogleDocsSearchContext> {
  const creds = await options.secrets.getCredentials();
  if (!creds.googleDocsToken) {
    return {
      source: "google-docs-search",
      query: "",
      documents: [],
      error: "Google Docs access token not configured."
    };
  }

  const query = buildRepoOrQuery(options.owner, options.repo);
  if (!query) {
    return {
      source: "google-docs-search",
      query: "",
      documents: [],
      error: "Set repository owner and repo in Settings to search Google Docs by repo."
    };
  }

  const client = new GoogleDocsClient({ accessToken: creds.googleDocsToken });
  try {
    const documents = await client.searchDocuments(query, options.limit ?? 20);
    const repoQuery =
      options.owner?.trim() && options.repo?.trim()
        ? `${options.owner.trim()}/${options.repo.trim()}`
        : options.repo?.trim();

    return {
      source: "google-docs-search",
      query,
      repoQuery,
      documents
    };
  } catch (error) {
    return {
      source: "google-docs-search",
      query,
      documents: [],
      error: error instanceof Error ? error.message : "Google Docs search failed."
    };
  }
}
