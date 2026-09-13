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
import { planJobSearchAttempts } from "./jobSearchPlan";
import { shouldFetchTraceDecisionDocIntegrations } from "./integrationFetchPolicy";
import { shouldFetchIntegrationWithAllowlist } from "./fetchIntegrationsAllowlist";
import { filterDocPagesForUseRepo } from "./integrationDocRelevance";
import type { ChatIntentJobVerb } from "../chat/intentPlanner/types";
import { isSearchMeaningStop } from "../chat/intentPlanner/searchMeaningStop";
import {
  emptySearchTopicError,
  latestNeedsScopeError,
  missingRepoSearchError
} from "./integrationJobErrors";

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
  return shouldFetchIntegrationWithAllowlist(request, "google-docs", () => {
    if (shouldFetchTraceDecisionDocIntegrations(request)) {
      return true;
    }
    if (request.type !== "chat_context") {
      return false;
    }
    return wantsGoogleDocsContext(request.intent.context.queryText ?? "");
  });
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
  jobScoped?: boolean;
  jobVerb?: ChatIntentJobVerb;
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

  const latest = Boolean(options.jobScoped && options.jobVerb === "latest");
  if (latest && !googleDocsLatestAllowlisted(options.integrationScope)) {
    return {
      source: "google-docs-search",
      query: "",
      documents: [],
      error: latestNeedsScopeError("Google Docs")
    };
  }
  const jobAttempts = options.jobScoped && !latest
    ? planJobSearchAttempts(options.extraTerms ?? [])
    : [];
  const terms = latest
    ? []
    : options.jobScoped
      ? driveSearchTokens(jobAttempts[0]?.text ? [jobAttempts[0].text] : [])
      : buildIntegrationSearchTermList({
          owner: options.owner,
          repo: options.repo,
          queryText: options.queryText,
          activeFile: options.activeFile,
          contextText: [...(options.contextText ?? []), ...(options.crossToolText ?? [])],
          extraTerms: options.extraTerms
        });
  if (!latest && terms.length === 0) {
    return {
      source: "google-docs-search",
      query: "",
      documents: [],
      error: options.jobScoped
        ? emptySearchTopicError("Google Docs")
        : missingRepoSearchError("Google Docs")
    };
  }

  const query = latest ? "latest" : terms.join(" OR ");
  const client = new GoogleDocsClient({ accessToken: creds.googleDocsToken });
  const driveScope =
    options.integrationScope?.enforced && options.integrationScope.googleDocs
      ? { expandedFolderIds: options.integrationScope.googleDocs.expandedFolderIds }
      : undefined;
  const allowedFolderIds = new Set(options.integrationScope?.googleDocs?.expandedFolderIds ?? []);
  try {
    const searchLimit = options.limit ?? 20;
    let rawDocuments = latest
      ? await client.listRecentDocuments(searchLimit, driveScope)
      : await client.searchDocumentsForTerms(terms, searchLimit, driveScope);
    const retryTokens = driveSearchTokens(jobAttempts[1]?.text ? [jobAttempts[1].text] : []);
    if (!latest && options.jobScoped && rawDocuments.length === 0 && retryTokens.length > 0) {
      rawDocuments = await client.searchDocumentsForTerms(retryTokens, searchLimit, driveScope);
    }
    const scoped =
      options.integrationScope?.enforced && allowedFolderIds.size > 0
        ? filterGoogleDocsHitsByFolder(rawDocuments, allowedFolderIds).map(stripGoogleDocParents)
        : rawDocuments.map(stripGoogleDocParents);
    const documents = latest
      ? scoped.slice(0, options.limit ?? 20)
      : filterDocPagesForUseRepo(scoped, {
          owner: options.owner,
          repo: options.repo,
          focusTerms: options.extraTerms,
          limit: options.limit ?? 20
        });
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

const DRIVE_SEARCH_STOP = new Set(["not", "the", "and", "for", "this", "that", "into", "from", "with", "to"]);

/** Drive `contains` matches one token. A hyphen or a phrase is not a token. */
export function driveSearchTokens(terms: string[]): string[] {
  const tokens: string[] = [];
  for (const term of terms) {
    for (const raw of term.split(/[\s\-–—]+/)) {
      const token = raw.replace(/[^\w]/g, "");
      if (
        token.length >= 3 &&
        !DRIVE_SEARCH_STOP.has(token.toLowerCase()) &&
        !isSearchMeaningStop(token) &&
        !tokens.includes(token)
      ) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

function googleDocsLatestAllowlisted(scope: ResolvedIntegrationScope | undefined): boolean {
  return Boolean(
    scope?.enforced &&
      scope.allowed &&
      (scope.googleDocs?.expandedFolderIds.length ?? 0) > 0
  );
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
