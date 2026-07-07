import { GoogleDocsClient } from "../api/googleDocs/googleDocsClient";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import {
  filterGoogleDocsHitsByFolder,
  isGoogleDocsScopeBlocked,
  googleDocsScopeBlockMessage
} from "../integrationScope/googleDocsQuery";
import { buildIntegrationSearchTermList } from "./integrationSearchTerms";
import { shouldFetchTraceDecisionDocIntegrations } from "./integrationFetchPolicy";

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
  if (shouldFetchTraceDecisionDocIntegrations(request)) {
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
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
  limit?: number;
  extraTerms?: string[];
  integrationScope?: ResolvedIntegrationScope;
}): Promise<GoogleDocsSearchContext> {
  if (isGoogleDocsScopeBlocked(options.integrationScope)) {
    return {
      source: "google-docs-search",
      query: "",
      documents: [],
      error: googleDocsScopeBlockMessage(options.integrationScope)
    };
  }

  const creds = await options.secrets.getCredentials();
  if (!creds.googleDocsToken) {
    return {
      source: "google-docs-search",
      query: "",
      documents: [],
      error: "Google Docs access token not configured."
    };
  }

  const terms = buildIntegrationSearchTermList({
    owner: options.owner,
    repo: options.repo,
    queryText: options.queryText,
    activeFile: options.activeFile,
    contextText: [...(options.contextText ?? []), ...(options.crossToolText ?? [])],
    extraTerms: options.extraTerms
  });
  if (terms.length === 0) {
    return {
      source: "google-docs-search",
      query: "",
      documents: [],
      error: "Set repository owner and repo in Settings to search Google Docs by repo."
    };
  }

  const query = terms.join(" OR ");
  const client = new GoogleDocsClient({ accessToken: creds.googleDocsToken });
  const driveScope =
    options.integrationScope?.enforced && options.integrationScope.googleDocs
      ? { expandedFolderIds: options.integrationScope.googleDocs.expandedFolderIds }
      : undefined;
  const allowedFolderIds = new Set(options.integrationScope?.googleDocs?.expandedFolderIds ?? []);
  try {
    const rawDocuments = await client.searchDocumentsForTerms(terms, options.limit ?? 20, driveScope);
    const documents =
      options.integrationScope?.enforced && allowedFolderIds.size > 0
        ? filterGoogleDocsHitsByFolder(rawDocuments, allowedFolderIds).map(stripGoogleDocParents)
        : rawDocuments.map(stripGoogleDocParents);
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

function stripGoogleDocParents(doc: {
  id: string;
  title: string;
  updated: string;
  htmlUrl: string;
  parents?: string[];
}): GoogleDocsSearchPage {
  return {
    id: doc.id,
    title: doc.title,
    updated: doc.updated,
    htmlUrl: doc.htmlUrl
  };
}
