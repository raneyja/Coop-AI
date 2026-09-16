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
import { filterDocPagesForUseRepo, sanitizeIntegrationSnippet } from "./integrationDocRelevance";
import { looksLikeDecisionDocTitle } from "./confluenceContext";
import type { ChatIntentJobVerb } from "../chat/intentPlanner/types";
import { isSearchMeaningStop } from "../chat/intentPlanner/searchMeaningStop";
import { clipOpenedBody, openHitsByIds } from "../api/integrations/openHitsByIds";
import { OPENED_ARTIFACT_BODY_CHARS } from "../api/integrations/integrationHttp";
import { messageNamesProduct } from "../chat/intentPlanner/planChatJobs";
import {
  emptySearchTopicError,
  latestNeedsScopeError,
  missingRepoSearchError
} from "./integrationJobErrors";

export type GoogleDocsSearchPage = {
  id: string;
  title: string;
  excerpt?: string;
  updated: string;
  htmlUrl: string;
  opened?: boolean;
};

export type GoogleDocsSearchContext = {
  source: "google-docs-search";
  query: string;
  repoQuery?: string;
  documents: GoogleDocsSearchPage[];
  error?: string;
};

/** Injectable Google Docs client for tests — production uses credentials. */
export type GoogleDocsSearchClient = {
  searchDocumentsForTerms(
    terms: string[],
    limit?: number,
    scope?: { expandedFolderIds: string[] }
  ): Promise<Array<{
    id: string;
    title: string;
    updated: string;
    htmlUrl: string;
    parents?: string[];
  }>>;
  listRecentDocuments(
    limit?: number,
    scope?: { expandedFolderIds: string[] }
  ): Promise<Array<{
    id: string;
    title: string;
    updated: string;
    htmlUrl: string;
    parents?: string[];
  }>>;
  getDocumentPlainText?(documentId: string): Promise<string | undefined>;
};

export function wantsGoogleDocsContext(query: string): boolean {
  return messageNamesProduct(query, "google-docs");
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
  /** Repo-wide Gaps: open document bodies after a hit. */
  openAfterHit?: boolean;
  searchOnly?: boolean;
  openIds?: string[];
  existingHits?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Test seam — production leaves this unset and builds a client from secrets. */
  client?: GoogleDocsSearchClient;
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
  if (!creds.googleDocsToken && !options.client) {
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
  if (!latest && terms.length === 0 && !(options.openIds?.length && Array.isArray(options.existingHits?.documents))) {
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
  const client =
    options.client ??
    new GoogleDocsClient({ accessToken: creds.googleDocsToken!, signal: options.signal });
  const existingDocs = (options.existingHits?.documents ?? []) as GoogleDocsSearchPage[];
  if (options.openIds?.length && existingDocs.length > 0) {
    const documents = await attachGoogleDocBodies(client, existingDocs, {
      jobScoped: false,
      openIds: options.openIds
    });
    return { source: "google-docs-search", query: "", documents };
  }
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
    const ranked = latest
      ? scoped.slice(0, options.limit ?? 20)
      : filterDocPagesForUseRepo(scoped, {
          owner: options.owner,
          repo: options.repo,
          focusTerms: options.extraTerms,
          limit: options.limit ?? 20
        });
    const documents = options.searchOnly
      ? ranked
      : await attachGoogleDocBodies(client, ranked, {
          jobScoped: Boolean(
            (options.jobScoped && options.jobVerb !== "latest") || options.openAfterHit
          ),
          openIds: options.openIds
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

const OPENED_PAGE_BODY_CHARS = OPENED_ARTIFACT_BODY_CHARS;
const MAX_OPENED_PAGES = 3;

function pagesToOpen(
  pages: GoogleDocsSearchPage[],
  jobScoped: boolean
): GoogleDocsSearchPage[] {
  const picked: GoogleDocsSearchPage[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (!looksLikeDecisionDocTitle(page.title)) {
      continue;
    }
    if (picked.length >= MAX_OPENED_PAGES) {
      break;
    }
    seen.add(page.id);
    picked.push(page);
  }
  if (jobScoped) {
    for (const page of pages) {
      if (picked.length >= MAX_OPENED_PAGES) {
        break;
      }
      if (seen.has(page.id)) {
        continue;
      }
      seen.add(page.id);
      picked.push(page);
    }
  }
  return picked;
}

async function attachGoogleDocBodies(
  client: GoogleDocsSearchClient,
  pages: GoogleDocsSearchPage[],
  options: { jobScoped: boolean; openIds?: string[] }
): Promise<GoogleDocsSearchPage[]> {
  if (pages.length === 0 || !client.getDocumentPlainText) {
    return pages;
  }
  if (options.openIds?.length) {
    return openHitsByIds({
      hits: pages,
      ids: options.openIds,
      idOf: (page) => page.id,
      openOne: async (page) => {
        try {
          const raw = await client.getDocumentPlainText?.(page.id);
          const excerpt = sanitizeIntegrationSnippet(
            clipOpenedBody(raw, OPENED_PAGE_BODY_CHARS) ?? ""
          );
          return excerpt ? { ...page, excerpt, opened: true } : { ...page, opened: true };
        } catch {
          return { ...page, opened: true };
        }
      }
    });
  }
  const selected = pagesToOpen(pages, options.jobScoped);
  if (selected.length === 0) {
    return pages;
  }
  const bodies = await Promise.all(
    selected.map(async (page) => {
      try {
        const body = await client.getDocumentPlainText?.(page.id);
        return { id: page.id, body };
      } catch {
        return { id: page.id, body: undefined };
      }
    })
  );
  const byId = new Map(bodies.map((entry) => [entry.id, entry.body]));
  return pages.map((page) => {
    const raw = byId.get(page.id);
    if (!raw?.trim()) {
      return page;
    }
    const excerpt = sanitizeIntegrationSnippet(truncate(raw, OPENED_PAGE_BODY_CHARS));
    return excerpt ? { ...page, excerpt } : page;
  });
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
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
