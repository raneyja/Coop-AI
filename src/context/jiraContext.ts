import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import { JiraClient, type JiraIssue } from "../api/jira/jiraClient";
import { createJiraClientFromCredentials } from "../api/integrations/buildIntegrationClients";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";

export type JiraSearchTicket = {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  updated: string;
  htmlUrl: string;
  labels?: string[];
};

export type JiraSearchContext = {
  source: "jira-search";
  jql: string;
  repoQuery?: string;
  issues: JiraSearchTicket[];
  issueKeyHits?: string[];
  /** Issue keys discovered in recent commit messages or PR titles for this repo. */
  repoKeyHits?: string[];
  /** How issues were matched: text (Jira mentions repo), git (keys in commits/PRs), key (user-supplied), none. */
  matchStrategy?: "text" | "git" | "key" | "none";
  /** Human-readable note when fallback search strategies were used. */
  searchNote?: string;
  error?: string;
};

/** True when a free-form chat message likely needs live Jira evidence. */
export function wantsJiraContext(query: string): boolean {
  const q = query.trim();
  if (!q) {
    return false;
  }
  if (/\bjira\b/i.test(q)) {
    return true;
  }
  if (/\btickets?\b/i.test(q) && /\b(repo|repository|project|refer|related|link|this)\b/i.test(q)) {
    return true;
  }
  return JiraClient.extractIssueKeys(q).length > 0;
}

/** Repo-wide discovery — user expects tickets linked to the open repo, not a known key. */
export function wantsRepoLinkedJiraDiscovery(query: string): boolean {
  const q = query.trim();
  if (!q) {
    return false;
  }
  if (/\b(this repo|this repository|from this repo|for this repo|to this repo)\b/i.test(q)) {
    return true;
  }
  if (/\btickets?\b/i.test(q) && /\b(related|linked|associated|refer|repo|repository)\b/i.test(q)) {
    return true;
  }
  return false;
}

export function shouldFetchJiraContext(request: ContextFetchRequest): boolean {
  if (request.params.integrationProvider === "jira") {
    return true;
  }
  if (request.type !== "chat_context") {
    return false;
  }
  return wantsJiraContext(request.intent.context.queryText ?? "");
}

export function buildRepoJql(owner: string | undefined, repo: string | undefined): string | undefined {
  const repoName = repo?.trim();
  if (!repoName) {
    return undefined;
  }
  const clauses: string[] = [];
  const ownerName = owner?.trim();
  if (ownerName) {
    const full = `${ownerName}/${repoName}`;
    clauses.push(`text ~ "${escapeJqlString(full)}"`);
    clauses.push(`text ~ "${escapeJqlString(`github:${full}`)}"`);
  }
  clauses.push(`text ~ "${escapeJqlString(repoName)}"`);
  clauses.push(`summary ~ "${escapeJqlString(repoName)}"`);
  const repoSlug = repoName.replace(/_/g, "-");
  if (repoSlug.toLowerCase() !== repoName.toLowerCase()) {
    clauses.push(`text ~ "${escapeJqlString(repoSlug)}"`);
    clauses.push(`summary ~ "${escapeJqlString(repoSlug)}"`);
  }
  return `(${clauses.join(" OR ")}) ORDER BY updated DESC`;
}

export function collectJiraKeysFromText(...chunks: Array<string | undefined>): string[] {
  const keys = new Set<string>();
  for (const chunk of chunks) {
    for (const key of JiraClient.extractIssueKeys(chunk ?? "")) {
      keys.add(key);
    }
  }
  return [...keys];
}

export async function collectJiraKeysFromRepoActivity(options: {
  router: CodeHostRouter;
  owner: string;
  repo: string;
  commitLimit?: number;
  prLimit?: number;
}): Promise<string[]> {
  const keys = new Set<string>();
  try {
    const commits = await options.router.getCommitHistory({
      owner: options.owner,
      repo: options.repo,
      limit: options.commitLimit ?? 50
    });
    for (const commit of commits) {
      for (const key of JiraClient.extractIssueKeys(commit.message)) {
        keys.add(key);
      }
    }

    const prs = await options.router.listRepoPullRequests(
      { owner: options.owner, repo: options.repo },
      { state: "all", limit: options.prLimit ?? 30 }
    );
    for (const pr of prs) {
      for (const key of JiraClient.extractIssueKeys(pr.title)) {
        keys.add(key);
      }
    }
  } catch {
    /* code host optional */
  }
  return [...keys];
}

export async function fetchJiraSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  queryText?: string;
  limit?: number;
  codeHostRouter?: CodeHostRouter;
  codeHostConnected?: boolean;
}): Promise<JiraSearchContext> {
  const creds = await options.secrets.getCredentials();
  const client = createJiraClientFromCredentials(creds);
  if (!client) {
    return {
      source: "jira-search",
      jql: "",
      issues: [],
      error: "Jira credentials not configured."
    };
  }

  const queryText = options.queryText ?? "";
  const issueKeys = JiraClient.extractIssueKeys(queryText);
  const issuesByKey = new Map<string, JiraIssue>();
  const limit = options.limit ?? 20;

  for (const key of issueKeys) {
    await addIssueByKey(client, issuesByKey, key);
  }

  const jql = buildRepoJql(options.owner, options.repo);
  let searchError: string | undefined;
  let textSearchCount = 0;
  if (jql) {
    try {
      const searchHits = await client.searchIssues(jql, limit);
      textSearchCount = searchHits.length;
      for (const issue of searchHits) {
        issuesByKey.set(issue.key, issue);
      }
    } catch (error) {
      searchError = error instanceof Error ? error.message : "Jira search failed.";
    }
  }

  let repoKeyHits: string[] | undefined;
  const owner = options.owner?.trim();
  const repo = options.repo?.trim();
  const shouldScanGit =
    Boolean(owner && repo && options.codeHostRouter && options.codeHostConnected) &&
    issueKeys.length === 0 &&
    (textSearchCount === 0 || wantsRepoLinkedJiraDiscovery(queryText));

  if (shouldScanGit && owner && repo && options.codeHostRouter) {
    repoKeyHits = await collectJiraKeysFromRepoActivity({
      router: options.codeHostRouter,
      owner,
      repo
    });
    for (const key of repoKeyHits) {
      await addIssueByKey(client, issuesByKey, key);
    }
  }

  const repoQuery = owner && repo ? `${owner}/${repo}` : options.repo?.trim();
  let searchNote: string | undefined;
  let matchStrategy: JiraSearchContext["matchStrategy"] = "none";

  if (textSearchCount > 0) {
    matchStrategy = "text";
  } else if (repoKeyHits?.length && issuesByKey.size > 0) {
    matchStrategy = "git";
    searchNote =
      "Tickets below were found via Jira issue keys referenced in recent commits or pull requests for this repository.";
  } else if (issueKeys.length > 0 && issuesByKey.size > 0) {
    matchStrategy = "key";
  } else if (textSearchCount === 0 && issuesByKey.size === 0 && jql && !searchError) {
    searchNote =
      `No Jira tickets mention ${repoQuery ?? "this repository"} in summary or description, ` +
      "and no issue keys were found in recent git history. " +
      "Link work by adding the repo slug to ticket text (e.g. github:owner/repo) or reference keys in commits (e.g. COOP-101). " +
      "Ask about a specific key with `/jira COOP-101`.";
  }

  if (issuesByKey.size === 0 && !jql && issueKeys.length === 0) {
    return {
      source: "jira-search",
      jql: "",
      issues: [],
      error: "Set repository owner and repo in Settings to search Jira by repo."
    };
  }

  return {
    source: "jira-search",
    jql: jql ?? "",
    repoQuery,
    issues: mapIssues([...issuesByKey.values()]),
    issueKeyHits: issueKeys.length > 0 ? issueKeys : undefined,
    repoKeyHits: repoKeyHits?.length ? repoKeyHits : undefined,
    matchStrategy,
    searchNote,
    error: searchError
  };
}

async function addIssueByKey(
  client: JiraClient,
  issuesByKey: Map<string, JiraIssue>,
  key: string
): Promise<void> {
  if (issuesByKey.has(key)) {
    return;
  }
  try {
    const issue = await client.getIssue(key);
    issuesByKey.set(issue.key, issue);
  } catch {
    /* skip missing keys */
  }
}

function mapIssues(issues: JiraIssue[]): JiraSearchTicket[] {
  return issues.map((issue) => ({
    key: issue.key,
    summary: issue.summary,
    status: issue.status,
    issueType: issue.issueType,
    updated: issue.updated,
    htmlUrl: issue.htmlUrl,
    labels: issue.labels.length > 0 ? issue.labels : undefined
  }));
}

function escapeJqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
