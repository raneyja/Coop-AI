import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { CodeHostProvider } from "../api/codeHosts/types";
import type { ContextFetchRequest } from "./requestBatcher";
import { wantsExplicitCodeHostSearch } from "../chat/intentPlanner/planChatJobs";
import type { ChatIntentJobVerb } from "../chat/intentPlanner/types";
import { sanitizeIntegrationSnippet } from "./integrationDocRelevance";
import { missingRepoSearchError } from "./integrationJobErrors";

export type CodeHostPullRequestSnippet = {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  author?: string;
  updatedAt: string;
  htmlUrl?: string;
  /** Opened PR description from getPullRequestDetail — not the list title. */
  body?: string;
  /** True when body came from getPullRequestDetail. */
  bodyOpened?: boolean;
};

export type CodeHostIssueSnippet = {
  number: number;
  title: string;
  state: string;
  author?: string;
  updatedAt: string;
  htmlUrl?: string;
};

export type CodeHostSearchContext = {
  source: "code-host-search";
  provider: CodeHostProvider;
  repoQuery?: string;
  pullRequests: CodeHostPullRequestSnippet[];
  issues: CodeHostIssueSnippet[];
  prNumberHits?: number[];
  error?: string;
};

export function wantsCodeHostContext(query: string): boolean {
  return wantsExplicitCodeHostSearch(query);
}

export function shouldFetchCodeHostContext(request: ContextFetchRequest): boolean {
  if (request.type !== "chat_context" && request.type !== "dependencies") {
    return false;
  }
  if (request.params.quickAction === "blast-radius") {
    return true;
  }
  return wantsCodeHostContext(request.intent.context.queryText ?? "");
}

export async function fetchCodeHostSearchContext(options: {
  router: CodeHostRouter;
  provider?: CodeHostProvider;
  owner?: string;
  repo?: string;
  queryText?: string;
  limit?: number;
  jobVerb?: ChatIntentJobVerb;
  /** Chat Intent / agent job path — open PR bodies after a hit. */
  jobScoped?: boolean;
  /**
   * Explicit opt-in to open PR descriptions. Chat enrichment sets this.
   * Blast must omit it so bulk list stays title/state only.
   */
  openPullBodies?: boolean;
}): Promise<CodeHostSearchContext> {
  const provider = options.provider ?? "github";
  const owner = options.owner?.trim();
  const repo = options.repo?.trim();
  if (!owner || !repo) {
    return {
      source: "code-host-search",
      provider,
      pullRequests: [],
      issues: [],
      error: missingRepoSearchError("pull requests and issues")
    };
  }

  const prNumbers = options.jobVerb === "latest" ? [] : extractPrNumbers(options.queryText ?? "");
  const searchTerms =
    options.jobVerb === "latest" ? [] : extractCodeHostFilterTerms(options.queryText ?? "");
  const limit = options.limit ?? 20;
  const coords = { provider, owner, repo };

  try {
    let pullRequests = await options.router.listRepoPullRequests(coords, { state: "all", limit: 50 });
    let issues = await options.router.listRepoIssues(coords, { state: "all", limit: 50 });

    if (prNumbers.length > 0) {
      const wanted = new Set(prNumbers);
      pullRequests = pullRequests.filter((pr) => wanted.has(pr.number));
    } else if (searchTerms.length > 0) {
      const matchesTerms = (title: string): boolean => {
        const normalized = title.toLowerCase();
        return searchTerms.some((term) => normalized.includes(term));
      };
      pullRequests = pullRequests.filter((pr) => matchesTerms(pr.title));
      issues = issues.filter((issue) => matchesTerms(issue.title));
    }

    const mapped = pullRequests.slice(0, limit).map(mapPullRequest);
    const shouldOpen = shouldOpenPullBodies({
      openPullBodies: options.openPullBodies,
      jobScoped: options.jobScoped,
      jobVerb: options.jobVerb,
      prNumberHits: prNumbers
    });
    const opened = shouldOpen
      ? await attachPullRequestBodies(options.router, coords, mapped)
      : mapped;

    return {
      source: "code-host-search",
      provider,
      repoQuery: `${owner}/${repo}`,
      pullRequests: opened,
      issues: issues.slice(0, limit).map(mapIssue),
      prNumberHits: prNumbers.length > 0 ? prNumbers : undefined
    };
  } catch (error) {
    return {
      source: "code-host-search",
      provider,
      repoQuery: `${owner}/${repo}`,
      pullRequests: [],
      issues: [],
      error: error instanceof Error ? error.message : "Code host search failed."
    };
  }
}

const OPENED_PR_BODY_CHARS = 1500;
const MAX_OPENED_PRS = 3;

function shouldOpenPullBodies(options: {
  openPullBodies?: boolean;
  jobScoped?: boolean;
  jobVerb?: ChatIntentJobVerb;
  prNumberHits: number[];
}): boolean {
  if (options.jobVerb === "latest") {
    return false;
  }
  if (options.prNumberHits.length > 0) {
    return true;
  }
  if (options.openPullBodies === true) {
    return true;
  }
  if (options.jobScoped) {
    return true;
  }
  return false;
}

async function attachPullRequestBodies(
  router: CodeHostRouter,
  coords: { provider: CodeHostProvider; owner: string; repo: string },
  pullRequests: CodeHostPullRequestSnippet[]
): Promise<CodeHostPullRequestSnippet[]> {
  if (pullRequests.length === 0 || typeof router.getPullRequestDetail !== "function") {
    return pullRequests;
  }
  const selected = pullRequests.slice(0, MAX_OPENED_PRS);
  const bodies = await Promise.all(
    selected.map(async (pr) => {
      try {
        const detail = await router.getPullRequestDetail(pr.number, coords);
        return { number: pr.number, body: detail.body };
      } catch {
        return { number: pr.number, body: undefined };
      }
    })
  );
  const byNumber = new Map(bodies.map((entry) => [entry.number, entry.body]));
  return pullRequests.map((pr) => {
    const raw = byNumber.get(pr.number);
    if (!raw?.trim()) {
      return pr;
    }
    const body = sanitizeIntegrationSnippet(truncate(raw, OPENED_PR_BODY_CHARS));
    return body ? { ...pr, body, bodyOpened: true } : pr;
  });
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

function extractPrNumbers(query: string): number[] {
  const hits: number[] = [];
  const patterns = [
    /\b(?:PR|pull request|merge request|MR)\s*#?(\d+)\b/gi,
    /#(\d+)\b/g
  ];
  for (const pattern of patterns) {
    for (const match of query.matchAll(pattern)) {
      const num = Number(match[1]);
      if (Number.isFinite(num) && num > 0) {
        hits.push(num);
      }
    }
  }
  return [...new Set(hits)];
}

export function extractCodeHostFilterTerms(query: string): string[] {
  const generic = new Set([
    "search",
    "list",
    "show",
    "find",
    "open",
    "recent",
    "latest",
    "newest",
    "pull",
    "request",
    "requests",
    "merge",
    "issue",
    "issues",
    "github",
    "gitlab",
    "bitbucket",
    "repo",
    "repository",
    "this",
    "the",
    "for",
    "our",
    "any"
  ]);
  const withoutRefs = query.replace(/\b(?:PR|pull request|merge request|MR)\s*#?\s*\d+\b/gi, " ");
  const seen = new Set<string>();
  return (withoutRefs.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []).filter((term) => {
    if (generic.has(term) || seen.has(term)) {
      return false;
    }
    seen.add(term);
    return true;
  });
}

function mapPullRequest(pr: {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  author?: string;
  updatedAt: string;
  htmlUrl?: string;
}): CodeHostPullRequestSnippet {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    merged: pr.merged,
    author: pr.author,
    updatedAt: pr.updatedAt,
    htmlUrl: pr.htmlUrl
  };
}

function mapIssue(issue: {
  number: number;
  title: string;
  state: string;
  author?: string;
  updatedAt: string;
  htmlUrl?: string;
}): CodeHostIssueSnippet {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.author,
    updatedAt: issue.updatedAt,
    htmlUrl: issue.htmlUrl
  };
}
