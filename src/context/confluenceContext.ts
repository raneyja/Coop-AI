import { ConfluenceClient } from "../api/confluence/confluenceClient";
import {
  confluenceSiteUrlError,
  resolveConfluenceAuth,
  resolveConfluenceBaseUrl
} from "../api/confluence/resolveConfluenceBaseUrl";
import { createConfluenceClientFromCredentials } from "../api/integrations/buildIntegrationClients";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import {
  applyConfluenceSpaceScope,
  confluenceScopeBlockMessage,
  isConfluenceScopeBlocked
} from "../integrationScope/atlassianQuery";
import {
  buildConfluenceCql,
  buildConfluenceRepoOnlyCql,
  buildDecisionConfluenceCql,
  buildLatestConfluenceCql,
  buildRepoOrQuery
} from "./docSearchQuery";
import { planJobSearchAttempts } from "./jobSearchPlan";
import { filterDocPagesForUseRepo, sanitizeIntegrationSnippet } from "./integrationDocRelevance";
import { shouldFetchTraceDecisionDocIntegrations } from "./integrationFetchPolicy";
import { shouldFetchIntegrationWithAllowlist } from "./fetchIntegrationsAllowlist";
import type { ChatIntentJobVerb } from "../chat/intentPlanner/types";
import {
  emptySearchTopicError,
  latestNeedsScopeError,
  missingRepoSearchError
} from "./integrationJobErrors";

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
  query?: string;
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
  return shouldFetchIntegrationWithAllowlist(request, "confluence", () => {
    if (shouldFetchTraceDecisionDocIntegrations(request)) {
      return true;
    }
    if (request.type !== "chat_context") {
      return false;
    }
    return wantsConfluenceContext(request.intent.context.queryText ?? "");
  });
}

/** Injectable Confluence client for tests — production uses credentials. */
export type ConfluenceSearchClient = {
  searchPages(cql: string, limit?: number): Promise<Array<{
    id: string;
    title: string;
    excerpt?: string;
    updated: string;
    htmlUrl: string;
  }>>;
  getPageBody?(pageId: string): Promise<string | undefined>;
};

export async function fetchConfluenceSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  limit?: number;
  extraTerms?: string[];
  /** Chat Intent decision jobs — extras are the query; skip repo AND. */
  jobScoped?: boolean;
  jobVerb?: ChatIntentJobVerb;
  integrationScope?: ResolvedIntegrationScope;
  /** Test seam — production leaves this unset and builds a client from secrets. */
  client?: ConfluenceSearchClient;
}): Promise<ConfluenceSearchContext> {
  if (isConfluenceScopeBlocked(options.integrationScope)) {
    return {
      source: "confluence-search",
      cql: "",
      pages: [],
      error: confluenceScopeBlockMessage(options.integrationScope)
    };
  }

  const injectedClient = options.client;
  const creds = injectedClient ? undefined : await options.secrets.getCredentials();
  const auth = creds ? resolveConfluenceAuth(creds) : undefined;
  if (!injectedClient && !auth && !creds?.atlassianCloudId) {
    return {
      source: "confluence-search",
      cql: "",
      pages: [],
      error: "Confluence credentials not configured."
    };
  }

  const latest = Boolean(options.jobScoped && options.jobVerb === "latest");
  if (latest && !confluenceLatestAllowlisted(options.integrationScope)) {
    return {
      source: "confluence-search",
      cql: "",
      pages: [],
      error: latestNeedsScopeError("Confluence pages")
    };
  }
  const extrasOnly = Boolean(options.jobScoped && !latest && (options.extraTerms?.length ?? 0) > 0);
  const primaryCql = scopeConfluenceCql(
    latest
      ? buildLatestConfluenceCql()
      : extrasOnly
        ? buildDecisionConfluenceCql(options.extraTerms ?? [])
        : buildConfluenceCql(options.owner, options.repo, options.extraTerms),
    options.integrationScope
  );
  if (!primaryCql) {
    return {
      source: "confluence-search",
      cql: "",
      pages: [],
      error: options.jobScoped
        ? emptySearchTopicError("Confluence")
        : missingRepoSearchError("Confluence")
    };
  }

  let client: ConfluenceSearchClient | undefined = injectedClient;
  if (!client && creds) {
    const { baseUrl } = resolveConfluenceBaseUrl({
      confluenceBaseUrl: creds.confluenceBaseUrl,
      jiraBaseUrl: creds.jiraBaseUrl
    });
    const siteError = confluenceSiteUrlError(baseUrl);
    if (siteError && !creds.atlassianCloudId) {
      return {
        source: "confluence-search",
        cql: primaryCql,
        pages: [],
        error: siteError
      };
    }

    const oauthClient = createConfluenceClientFromCredentials(creds, baseUrl);
    client =
      oauthClient ??
      (auth
        ? new ConfluenceClient({
            baseUrl,
            email: auth.email,
            apiToken: auth.apiToken
          })
        : undefined);
  }
  if (!client) {
    return {
      source: "confluence-search",
      cql: primaryCql,
      pages: [],
      error: "Confluence credentials not configured."
    };
  }

  try {
    const limit = options.limit ?? 20;
    let pages = await client.searchPages(primaryCql, limit);
    let cql = primaryCql;
    // Job-scoped extras are the query. A repo-only fallback with hyphenated
    // slugs parse-errors and overwrites an honest empty extras search.
    const extrasOnly = Boolean(options.jobScoped && options.jobVerb !== "latest" && (options.extraTerms?.length ?? 0) > 0);
    if (pages.length === 0 && extrasOnly) {
      const words = planJobSearchAttempts(options.extraTerms ?? []).find(
        (attempt) => attempt.kind === "words"
      );
      const wordCql = words
        ? scopeConfluenceCql(buildDecisionConfluenceCql([words.text]), options.integrationScope)
        : undefined;
      if (wordCql && wordCql !== primaryCql) {
        pages = await client.searchPages(wordCql, limit);
        cql = wordCql;
      }
    } else if (pages.length === 0 && !extrasOnly && !latest) {
      const repoOnly = scopeConfluenceCql(
        buildConfluenceRepoOnlyCql(options.owner, options.repo),
        options.integrationScope
      );
      if (repoOnly && repoOnly !== primaryCql) {
        try {
          pages = await client.searchPages(repoOnly, limit);
          cql = repoOnly;
        } catch {
          /* keep the extras/primary result instead of a fallback parse error */
        }
      }
    }

    const repoQuery =
      options.owner?.trim() && options.repo?.trim()
        ? `${options.owner.trim()}/${options.repo.trim()}`
        : options.repo?.trim();

    const mapped = pages.map((page) => {
      const rawExcerpt = page.excerpt ? truncate(page.excerpt, 300) : undefined;
      const excerpt = sanitizeIntegrationSnippet(rawExcerpt);
      const title = sanitizeIntegrationSnippet(page.title) ?? page.title;
      return {
        id: page.id,
        title,
        excerpt,
        updated: page.updated,
        htmlUrl: page.htmlUrl
      };
    });

    const ranked = latest
      ? mapped.slice(0, limit)
      : filterDocPagesForUseRepo(mapped, {
          owner: options.owner,
          repo: options.repo,
          focusTerms: options.extraTerms,
          limit
        });
    const opened = await attachConfluencePageBodies(client, ranked, {
      jobScoped: Boolean(options.jobScoped && options.jobVerb !== "latest")
    });

    return {
      source: "confluence-search",
      cql,
      query: (options.extraTerms ?? []).join(" ").trim() || undefined,
      repoQuery,
      pages: opened
    };
  } catch (error) {
    return {
      source: "confluence-search",
      cql: primaryCql,
      pages: [],
      error: error instanceof Error ? error.message : "Confluence search failed."
    };
  }
}

export function confluenceFallbackQuery(owner?: string, repo?: string): string | undefined {
  return buildRepoOrQuery(owner, repo);
}

const OPENED_PAGE_BODY_CHARS = 1500;
const MAX_OPENED_PAGES = 3;

/** ADR / RFC / decision-record titles — open the page, don't stop at search. */
export function looksLikeDecisionDocTitle(title: string): boolean {
  return /\badr\b|architecture decision|decision record|\brfc\b|design doc|technical decision/i.test(
    title
  );
}

function pagesToOpen(
  pages: ConfluenceSearchPage[],
  jobScoped: boolean
): ConfluenceSearchPage[] {
  const picked: ConfluenceSearchPage[] = [];
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

async function attachConfluencePageBodies(
  client: ConfluenceSearchClient,
  pages: ConfluenceSearchPage[],
  options: { jobScoped: boolean }
): Promise<ConfluenceSearchPage[]> {
  if (pages.length === 0 || !client.getPageBody) {
    return pages;
  }
  const selected = pagesToOpen(pages, options.jobScoped);
  if (selected.length === 0) {
    return pages;
  }
  const bodies = await Promise.all(
    selected.map(async (page) => {
      try {
        const body = await client.getPageBody?.(page.id);
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

function scopeConfluenceCql(
  cql: string | undefined,
  integrationScope: ResolvedIntegrationScope | undefined
): string | undefined {
  if (!cql?.trim()) {
    return cql;
  }
  if (!integrationScope?.enforced || !integrationScope.atlassian) {
    return cql;
  }
  return applyConfluenceSpaceScope(
    [cql],
    integrationScope.atlassian.confluenceSpaceIds,
    integrationScope.atlassian.confluenceSpaceKeys
  )[0];
}

function confluenceLatestAllowlisted(scope: ResolvedIntegrationScope | undefined): boolean {
  return Boolean(
    scope?.enforced &&
      scope.allowed &&
      (scope.atlassian?.confluenceSpaceKeys.length ?? 0) > 0
  );
}
