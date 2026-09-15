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
import {
  emptySearchTopicError,
  latestNeedsScopeError,
  missingRepoSearchError
} from "./integrationJobErrors";

export type NotionSearchPage = {
  id: string;
  title: string;
  excerpt?: string;
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
  /** Test seam — production leaves this unset and builds a client from secrets. */
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
  const client =
    options.client ??
    new NotionClient({ token: creds.notionToken! });
  try {
    const limit = options.limit ?? 20;
    let rawPages = await searchNotionPagesForTerms(
      client,
      options.jobScoped ? terms.slice(0, 1) : terms,
      limit
    );
    if (options.jobScoped && rawPages.length === 0 && terms[1]) {
      rawPages = await searchNotionPagesForTerms(client, [terms[1]], limit);
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
    const pages = await attachNotionPageBodies(client, ranked, {
      jobScoped: Boolean(
        (options.jobScoped && options.jobVerb !== "latest") || options.openAfterHit
      )
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

const OPENED_PAGE_BODY_CHARS = 1500;
const MAX_OPENED_PAGES = 3;

function pagesToOpen(
  pages: NotionSearchPage[],
  jobScoped: boolean
): NotionSearchPage[] {
  const picked: NotionSearchPage[] = [];
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

async function attachNotionPageBodies(
  client: NotionSearchClient,
  pages: NotionSearchPage[],
  options: { jobScoped: boolean }
): Promise<NotionSearchPage[]> {
  if (pages.length === 0 || !client.getPagePlainText) {
    return pages;
  }
  const selected = pagesToOpen(pages, options.jobScoped);
  if (selected.length === 0) {
    return pages;
  }
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
