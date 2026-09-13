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
import { filterDocPagesForUseRepo } from "./integrationDocRelevance";
import type { ChatIntentJobVerb } from "../chat/intentPlanner/types";
import {
  emptySearchTopicError,
  latestNeedsScopeError,
  missingRepoSearchError
} from "./integrationJobErrors";

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
  if (!creds.notionToken) {
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
  const client = new NotionClient({ token: creds.notionToken });
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
    const pages = (latest
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

async function searchNotionPagesForTerms(
  client: NotionClient,
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
