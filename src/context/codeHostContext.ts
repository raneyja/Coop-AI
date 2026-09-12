import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { CodeHostProvider } from "../api/codeHosts/types";
import type { ContextFetchRequest } from "./requestBatcher";
import { wantsExplicitCodeHostSearch } from "../chat/intentPlanner/planChatJobs";

export type CodeHostPullRequestSnippet = {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  author?: string;
  updatedAt: string;
  htmlUrl?: string;
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
      error: "Set repository owner and repo in Settings to search pull requests and issues."
    };
  }

  const prNumbers = extractPrNumbers(options.queryText ?? "");
  const searchTerms = extractCodeHostFilterTerms(options.queryText ?? "");
  const limit = options.limit ?? 20;
  const coords = { provider, owner, repo };

  try {
    let pullRequests = await options.router.listRepoPullRequests(coords, { state: "all", limit: 50 });
    let issues = await options.router.listRepoIssues(coords, { state: "all", limit: 50 });

    if (prNumbers.length > 0) {
      const wanted = new Set(prNumbers);
      pullRequests = pullRequests.filter((pr) => wanted.has(pr.number));
    }
    if (searchTerms.length > 0) {
      const matchesTerms = (title: string): boolean => {
        const normalized = title.toLowerCase();
        return searchTerms.some((term) => normalized.includes(term));
      };
      pullRequests = pullRequests.filter((pr) => matchesTerms(pr.title));
      issues = issues.filter((issue) => matchesTerms(issue.title));
    }

    return {
      source: "code-host-search",
      provider,
      repoQuery: `${owner}/${repo}`,
      pullRequests: pullRequests.slice(0, limit).map(mapPullRequest),
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
