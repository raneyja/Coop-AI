import { NotionClient } from "../api/notion/notionClient";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import {
  filterNotionPagesByScope,
  isNotionScopeBlocked,
  notionScopeBlockMessage
} from "../integrationScope/notionQuery";
import { shouldFetchTraceDecisionDocIntegrations } from "./integrationFetchPolicy";
import { buildIntegrationSearchTermList } from "./integrationSearchTerms";
import { planJobSearchAttempts } from "./jobSearchPlan";
import { shouldFetchIntegrationWithAllowlist } from "./fetchIntegrationsAllowlist";
import { filterDocPagesForUseRepo, sanitizeIntegrationSnippet } from "./integrationDocRelevance";
import { looksLikeDecisionDocTitle } from "./confluenceContext";
import type { ChatIntentJobVerb } from "../chat/intentPlanner/types";
import { messageNamesProduct } from "../chat/intentPlanner/planChatJobs";
import {
  emptySearchTopicError,
  latestNeedsScopeError,
  missingRepoSearchError
} from "./integrationJobErrors";
import { clipOpenedBody, openHitsByIds } from "../api/integrations/openHitsByIds";
import { OPENED_ARTIFACT_BODY_CHARS } from "../api/integrations/integrationHttp";

export type NotionSearchPage = {
  id: string;
  title: string;
  excerpt?: string;
  updated: string;
  htmlUrl: string;
  /** Hint for Choose Open — not a rank picker. */
  titleMatchHint?: boolean;
  /** True after an Open attempt (body may still be missing). */
  opened?: boolean;
};

export type NotionSearchContext = {
  source: "notion-search";
  query: string;
  repoQuery?: string;
  pages: NotionSearchPage[];
  error?: string;
};

/** Injectable Notion client for tests — production uses credentials. */
export type NotionSearchClient = {
  searchPages(query: string, limit?: number): Promise<Array<{
    id: string;
    title: string;
    updated: string;
    htmlUrl: string;
    parentId?: string;
  }>>;
  getPagePlainText?(pageId: string): Promise<string | undefined>;
};

export function wantsNotionContext(query: string): boolean {
  return messageNamesProduct(query, "notion");
}

export function shouldFetchNotionContext(request: ContextFetchRequest): boolean {
  return shouldFetchIntegrationWithAllowlist(request, "notion", () => {
    if (shouldFetchTraceDecisionDocIntegrations(request)) {
      return true;
    }
    if (request.type !== "chat_context") {
      return false;
    }
    return wantsNotionContext(request.intent.context.queryText ?? "");
  });
}

export async function fetchNotionSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  limit?: number;
  extraTerms?: string[];
  jobScoped?: boolean;
  jobVerb?: ChatIntentJobVerb;
  integrationScope?: ResolvedIntegrationScope;
  /**
   * Repo-wide Gaps (and similar): open page bodies after a hit without
   * changing job-scoped search semantics.
   */
  openAfterHit?: boolean;
  /** Soft gather cutoff — return search hits even if page-body open has not finished. */
  deadlineAt?: number;
  /** Agent Search: return the full hit list without auto-opening bodies. */
  searchOnly?: boolean;
  /** Agent Choose-Open: fetch these page ids (ceiling 3). */
  openIds?: string[];
  /** Prior Search hits so Open does not re-query. */
  existingHits?: Record<string, unknown>;
  signal?: AbortSignal;
  /** Test seam — production leaves this unset and builds a client from credentials. */
  client?: NotionSearchClient;
}): Promise<NotionSearchContext> {
  if (isNotionScopeBlocked(options.integrationScope)) {
    return {
      source: "notion-search",
      query: "",
      pages: [],
      error: notionScopeBlockMessage(options.integrationScope)
    };
  }

  const creds = await options.secrets.getCredentials();
  if (!creds.notionToken && !options.client) {
    return {
      source: "notion-search",
      query: "",
      pages: [],
      error: "Notion integration token not configured."
    };
  }

  const client =
    options.client ??
    new NotionClient({ token: creds.notionToken!, signal: options.signal });
  const existingPages = pagesFromExistingHits(options.existingHits);
  if (options.openIds?.length && existingPages.length > 0) {
    const pages = await attachNotionPageBodies(client, existingPages, {
      jobScoped: false,
      openIds: options.openIds
    });
    return { source: "notion-search", query: "", pages };
  }

  const latest = Boolean(options.jobScoped && options.jobVerb === "latest");
  if (latest && !notionLatestAllowlisted(options.integrationScope)) {
    return {
      source: "notion-search",
      query: "",
      pages: [],
      error: latestNeedsScopeError("Notion pages")
    };
  }
  const jobAttempts = options.jobScoped && !latest
    ? planJobSearchAttempts(options.extraTerms ?? [])
    : [];
  const terms = latest
    ? [""]
    : options.jobScoped
      ? jobAttempts.map((attempt) => attempt.text)
      : buildIntegrationSearchTermList({
          owner: options.owner,
          repo: options.repo,
          extraTerms: options.extraTerms
        });
  if (!latest && terms.length === 0) {
    return {
      source: "notion-search",
      query: "",
      pages: [],
      error: options.jobScoped ? emptySearchTopicError("Notion") : missingRepoSearchError("Notion")
    };
  }

  const query = terms.join(" OR ");
  try {
    const limit = options.limit ?? 20;
    let rawPages = await searchNotionPagesForTerms(
      client,
      options.jobScoped ? terms.slice(0, 1) : terms,
      limit
    );
    if (options.jobScoped && rawPages.length === 0 && terms[1]) {
      const remainingMs =
        options.deadlineAt === undefined ? undefined : options.deadlineAt - Date.now();
      if (remainingMs === undefined || remainingMs > 2_000) {
        rawPages = await searchNotionPagesForTerms(client, [terms[1]], limit);
      }
    }
    const ranked = (latest
      ? filterScopedNotionPages(rawPages, options.integrationScope)
      : filterDocPagesForUseRepo(
          filterScopedNotionPages(rawPages, options.integrationScope),
          {
            owner: options.owner,
            repo: options.repo,
            focusTerms: options.extraTerms,
            limit: options.limit ?? 20
          }
        )
    );
    const pages = options.searchOnly
      ? withTitleHints(ranked, options.extraTerms)
      : await attachNotionPageBodies(client, ranked, {
          jobScoped: Boolean(
            (options.jobScoped && options.jobVerb !== "latest") || options.openAfterHit
          ),
          extraTerms: options.extraTerms,
          deadlineAt: options.deadlineAt,
          openIds: options.openIds
        });
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

const OPENED_PAGE_BODY_CHARS = OPENED_ARTIFACT_BODY_CHARS;
const MAX_OPENED_PAGES = 3;
/** Named-doc gather: one search hit, one body fetch — three pages blow the 9s budget. */
const MAX_JOB_SCOPED_OPENED_PAGES = 1;

function pagesFromExistingHits(existing: Record<string, unknown> | undefined): NotionSearchPage[] {
  const pages = existing?.pages;
  if (!Array.isArray(pages)) {
    return [];
  }
  return pages.filter(
    (page): page is NotionSearchPage =>
      Boolean(page) && typeof page === "object" && typeof (page as NotionSearchPage).id === "string"
  );
}

function withTitleHints(pages: NotionSearchPage[], extraTerms?: string[]): NotionSearchPage[] {
  return pages.map((page) => ({
    ...page,
    titleMatchHint: titleMatchesFocus(page.title, extraTerms)
  }));
}

function titleMatchesFocus(title: string, extraTerms: string[] | undefined): boolean {
  const hay = title.toLowerCase().replace(/[-–—]/g, " ");
  for (const term of extraTerms ?? []) {
    const normalized = term.trim().toLowerCase().replace(/[-–—]/g, " ");
    if (normalized.length >= 4 && hay.includes(normalized)) {
      return true;
    }
  }
  return false;
}

function pagesToOpen(
  pages: NotionSearchPage[],
  jobScoped: boolean,
  extraTerms?: string[]
): NotionSearchPage[] {
  const cap = jobScoped ? MAX_JOB_SCOPED_OPENED_PAGES : MAX_OPENED_PAGES;
  const picked: NotionSearchPage[] = [];
  const seen = new Set<string>();
  const take = (page: NotionSearchPage): boolean => {
    if (seen.has(page.id) || picked.length >= cap) {
      return picked.length >= cap;
    }
    seen.add(page.id);
    picked.push(page);
    return picked.length >= cap;
  };
  for (const page of pages) {
    if (titleMatchesFocus(page.title, extraTerms) && take(page)) {
      return picked;
    }
  }
  for (const page of pages) {
    if (looksLikeDecisionDocTitle(page.title) && take(page)) {
      return picked;
    }
  }
  if (jobScoped) {
    for (const page of pages) {
      if (take(page)) {
        return picked;
      }
    }
  }
  return picked;
}

async function attachNotionPageBodies(
  client: NotionSearchClient,
  pages: NotionSearchPage[],
  options: { jobScoped: boolean; extraTerms?: string[]; deadlineAt?: number; openIds?: string[] }
): Promise<NotionSearchPage[]> {
  if (pages.length === 0 || !client.getPagePlainText) {
    return pages;
  }
  const selected = options.openIds?.length
    ? pages
    : pagesToOpen(pages, options.jobScoped, options.extraTerms);
  if (selected.length === 0) {
    return pages;
  }
  const remainingMs =
    options.deadlineAt === undefined ? undefined : Math.max(0, options.deadlineAt - Date.now());
  if (remainingMs !== undefined && remainingMs <= 0) {
    return pages;
  }
  const openBodies = options.openIds?.length
    ? openHitsByIds({
        hits: pages,
        ids: options.openIds,
        idOf: (page) => page.id,
        openOne: async (page) => {
          try {
            const raw = await client.getPagePlainText?.(page.id);
            const excerpt = sanitizeIntegrationSnippet(
              clipOpenedBody(raw, OPENED_PAGE_BODY_CHARS) ?? ""
            );
            return excerpt ? { ...page, excerpt, opened: true } : { ...page, opened: true };
          } catch {
            return { ...page, opened: true };
          }
        }
      })
    : mergeOpenedPageBodies(client, pages, selected);
  if (remainingMs === undefined) {
    return openBodies;
  }
  return firstCompleted(openBodies, pages, remainingMs);
}

async function mergeOpenedPageBodies(
  client: NotionSearchClient,
  pages: NotionSearchPage[],
  selected: NotionSearchPage[]
): Promise<NotionSearchPage[]> {
  const bodies = await Promise.all(
    selected.map(async (page) => {
      try {
        const body = await client.getPagePlainText?.(page.id);
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

function firstCompleted<T>(work: Promise<T>, fallback: T, ms: number): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

async function searchNotionPagesForTerms(
  client: NotionSearchClient,
  terms: string[],
  limit: number
): Promise<Array<NotionSearchPage & { parentId?: string }>> {
  const seen = new Map<string, NotionSearchPage & { parentId?: string }>();
  for (const term of terms) {
    if (seen.size >= limit) {
      break;
    }
    const pages = await client.searchPages(term, limit - seen.size);
    for (const page of pages) {
      seen.set(page.id, {
        id: page.id,
        title: page.title,
        updated: page.updated,
        htmlUrl: page.htmlUrl,
        parentId: page.parentId
      });
    }
  }
  return [...seen.values()].slice(0, limit);
}

function filterScopedNotionPages(
  pages: Array<NotionSearchPage & { parentId?: string }>,
  integrationScope: ResolvedIntegrationScope | undefined
): NotionSearchPage[] {
  const resourceIds = integrationScope?.notion?.resourceIds ?? [];
  const scoped =
    integrationScope?.enforced && resourceIds.length > 0
      ? filterNotionPagesByScope(pages, new Set(resourceIds))
      : pages;
  return scoped.map(({ id, title, updated, htmlUrl }) => ({ id, title, updated, htmlUrl }));
}

function notionLatestAllowlisted(scope: ResolvedIntegrationScope | undefined): boolean {
  return Boolean(
    scope?.enforced && scope.allowed && (scope.notion?.resourceIds.length ?? 0) > 0
  );
}
