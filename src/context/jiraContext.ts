import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import { JiraClient, type JiraIssue } from "../api/jira/jiraClient";
import { createJiraClientFromCredentials } from "../api/integrations/buildIntegrationClients";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import {
  applyJiraProjectScope,
  filterJiraIssuesByProject,
  isJiraScopeBlocked,
  jiraScopeBlockMessage
} from "../integrationScope/atlassianQuery";
import { buildRepoSearchTerms } from "./docSearchQuery";
import { shouldFetchIncidentIntegrations } from "./incidentIntent";
import { shouldFetchTraceDecisionDocIntegrations } from "./integrationFetchPolicy";
import { shouldFetchIntegrationWithAllowlist } from "./fetchIntegrationsAllowlist";
import { filePathSearchTerms } from "./traceDecisionSearch";

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
  /** How issues were matched: text (Jira mentions repo), git (keys in commits/PRs), key (user-supplied), cross-tool, none. */
  matchStrategy?: "text" | "git" | "key" | "cross-tool" | "none";
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
  return shouldFetchIntegrationWithAllowlist(request, "jira", () => {
    if (shouldFetchTraceDecisionDocIntegrations(request)) {
      return true;
    }
    if (request.type !== "chat_context") {
      return false;
    }
    const queryText = request.intent.context.queryText ?? "";
    // Incident / on-call reconstruction (A9) — fetch even when the user did not say "jira".
    // Keep separate from wantsJiraContext so detectChatIntegrationProvider does not
    // single-route the turn to Jira-only synthesis.
    if (shouldFetchIncidentIntegrations(queryText)) {
      return true;
    }
    return wantsJiraContext(queryText);
  });
}

export function buildRepoJql(owner: string | undefined, repo: string | undefined): string | undefined {
  const repoClause = buildRepoClause(owner, repo);
  if (!repoClause) {
    return undefined;
  }
  return `${repoClause} ORDER BY updated DESC`;
}

/** True when a Jira search may merge the unfocused repo-wide ticket dump. */
export function shouldMergeRepoWideJiraHits(options: { hasFocusJql: boolean }): boolean {
  return !options.hasFocusJql;
}

/** Named keys (COOP-101) skip the 20-ticket focus dump. */
export function shouldRunJiraFocusTextSearch(namedIssueKeys: string[]): boolean {
  return namedIssueKeys.length === 0;
}

/** Focus terms for Jira text search (path stem, basename, caller extras). */
export function buildJiraFocusTerms(options: {
  activeFile?: string;
  extraTerms?: string[];
  owner?: string;
  repo?: string;
  queryText?: string;
}): string[] {
  const repoSlugs = new Set(
    buildRepoSearchTerms(options.owner, options.repo).map((term) => term.toLowerCase())
  );
  const terms = new Set<string>();
  const add = (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed.length < 3) {
      return;
    }
    if (repoSlugs.has(trimmed.toLowerCase())) {
      return;
    }
    terms.add(trimmed);
  };
  for (const term of filePathSearchTerms(options.activeFile)) {
    add(term);
  }
  const activeFile = options.activeFile?.trim().replace(/^\/+/, "");
  if (activeFile) {
    add(activeFile);
    const base = activeFile.split("/").pop() ?? activeFile;
    const stem = base.replace(/\.[^.]+$/, "");
    add(stem);
    for (const part of splitIdentifierTokens(stem)) {
      add(part);
    }
  }
  for (const term of options.extraTerms ?? []) {
    add(term);
  }
  for (const term of queryFocusTerms(options.queryText)) {
    add(term);
  }
  return [...terms].slice(0, 16);
}

/** Split camelCase / snake_case identifiers into searchable tokens. */
export function splitIdentifierTokens(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const spaced = trimmed
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .toLowerCase();
  return spaced
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);
}

const JIRA_QUERY_STOPWORDS = new Set([
  "check",
  "jira",
  "for",
  "open",
  "tickets",
  "ticket",
  "related",
  "this",
  "file",
  "the",
  "and",
  "with",
  "about",
  "what",
  "status",
  "please",
  "find",
  "any",
  "from"
]);

function queryFocusTerms(queryText: string | undefined): string[] {
  const q = queryText?.trim() ?? "";
  if (!q) {
    return [];
  }
  return q
    .split(/[^a-zA-Z0-9_./-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4 && !JIRA_QUERY_STOPWORDS.has(part.toLowerCase()));
}

/**
 * Prefer tickets that mention the open file / focus terms within the Use-repo.
 * Returns undefined when there is no focus (caller should use buildRepoJql).
 */
export function buildFocusAwareJiraJql(options: {
  owner?: string;
  repo?: string;
  activeFile?: string;
  extraTerms?: string[];
  queryText?: string;
}): string | undefined {
  const repoClause = buildRepoClause(options.owner, options.repo);
  const focusTerms = buildJiraFocusTerms(options);
  if (!repoClause || focusTerms.length === 0) {
    return undefined;
  }
  const focusClauses = new Set<string>();
  for (const term of focusTerms) {
    focusClauses.add(`text ~ "${escapeJqlString(term)}"`);
    focusClauses.add(`summary ~ "${escapeJqlString(term)}"`);
  }
  return `(${repoClause}) AND (${[...focusClauses].join(" OR ")}) ORDER BY updated DESC`;
}

export function wantsOpenTickets(query: string | undefined): boolean {
  const q = query?.trim().toLowerCase() ?? "";
  if (!q) {
    return false;
  }
  return /\bopen\s+tickets?\b/.test(q) || /\b(in\s+progress|active|unresolved)\s+tickets?\b/.test(q);
}

function isDoneStatus(status: string | undefined): boolean {
  const s = (status ?? "").trim().toLowerCase();
  return s === "done" || s === "closed" || s === "resolved" || s === "complete" || s === "completed";
}

/**
 * Rank Jira hits so path/focus matches beat newest-repo dump.
 * Keep all issues; callers slice after rank.
 */
export function rankJiraIssuesForFocus<T extends { key: string; summary: string; status: string }>(
  issues: T[],
  options: {
    activeFile?: string;
    queryText?: string;
    extraTerms?: string[];
    owner?: string;
    repo?: string;
  }
): T[] {
  if (issues.length <= 1) {
    return issues;
  }
  const focusTerms = buildJiraFocusTerms(options).map((term) => term.toLowerCase());
  const preferOpen = wantsOpenTickets(options.queryText);

  const scored = issues.map((issue, index) => {
    const haystack = `${issue.key} ${issue.summary}`.toLowerCase();
    let score = 0;
    for (const term of focusTerms) {
      if (haystack.includes(term.toLowerCase())) {
        score += term.includes("/") || term.includes(".") ? 40 : 25;
      }
    }
    if (preferOpen && !isDoneStatus(issue.status)) {
      score += 20;
    }
    if (preferOpen && isDoneStatus(issue.status)) {
      score -= 30;
    }
    // Stable tie-break: original order (usually updated DESC).
    return { issue, score, index };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.issue);
}

export function buildIssueKeysJql(keys: string[]): string | undefined {
  const normalized = [...new Set(keys.map((key) => key.toUpperCase()))];
  if (normalized.length === 0) {
    return undefined;
  }
  const list = normalized.map((key) => `"${key}"`).join(", ");
  return `key in (${list}) ORDER BY updated DESC`;
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
  activeFile?: string;
  contextText?: string[];
  /** Titles/excerpts from Confluence, Notion, or other doc integrations for cross-tool key discovery. */
  crossToolText?: string[];
  /** File/focus extras (path stems, Gaps phrases) — same list Slack/Confluence already use. */
  extraTerms?: string[];
  limit?: number;
  codeHostRouter?: CodeHostRouter;
  codeHostConnected?: boolean;
  integrationScope?: ResolvedIntegrationScope;
}): Promise<JiraSearchContext> {
  if (isJiraScopeBlocked(options.integrationScope)) {
    return {
      source: "jira-search",
      jql: "",
      issues: [],
      error: jiraScopeBlockMessage(options.integrationScope)
    };
  }

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
  const contextKeys = collectJiraKeysFromText(...(options.contextText ?? []), options.activeFile);
  const crossToolKeys = collectJiraKeysFromText(...(options.crossToolText ?? []));
  const queryKeys = JiraClient.extractIssueKeys(queryText);
  const discoveredKeys = new Set([...queryKeys, ...contextKeys, ...crossToolKeys]);
  const issuesByKey = new Map<string, JiraIssue>();
  const limit = options.limit ?? 20;
  const focusJqlOptions = {
    owner: options.owner,
    repo: options.repo,
    activeFile: options.activeFile,
    extraTerms: options.extraTerms,
    queryText
  };

  for (const key of discoveredKeys) {
    await addIssueByKey(client, issuesByKey, key);
  }

  const focusJql = scopeJql(buildFocusAwareJiraJql(focusJqlOptions), options.integrationScope);
  const repoJql = scopeJql(buildRepoJql(options.owner, options.repo), options.integrationScope);
  let searchError: string | undefined;
  let textSearchCount = 0;
  let usedJql = focusJql ?? repoJql ?? "";

  if (focusJql && shouldRunJiraFocusTextSearch(queryKeys)) {
    try {
      const focusHits = await client.searchIssues(focusJql, limit);
      textSearchCount = focusHits.length;
      for (const issue of focusHits) {
        issuesByKey.set(issue.key, issue);
      }
    } catch (error) {
      searchError = error instanceof Error ? error.message : "Jira search failed.";
    }
  }

  // Repo-wide dump only when the user named no file/symbol/focus.
  // Compound "requireAuth + Jira" must not fail-open into 20 unrelated tickets.
  if (shouldMergeRepoWideJiraHits({ hasFocusJql: Boolean(focusJql) }) && repoJql) {
    try {
      const repoHits = await client.searchIssues(repoJql, limit);
      textSearchCount = repoHits.length;
      usedJql = repoJql;
      for (const issue of repoHits) {
        issuesByKey.set(issue.key, issue);
      }
    } catch (error) {
      if (!searchError) {
        searchError = error instanceof Error ? error.message : "Jira search failed.";
      }
    }
  }

  const jql = usedJql;

  const owner = options.owner?.trim();
  const repo = options.repo?.trim();
  let repoKeyHits: string[] | undefined;
  const shouldScanGit =
    textSearchCount === 0 &&
    Boolean(owner && repo && options.codeHostRouter && options.codeHostConnected);

  if (shouldScanGit && owner && repo && options.codeHostRouter) {
    repoKeyHits = await collectJiraKeysFromRepoActivity({
      router: options.codeHostRouter,
      owner,
      repo
    });
    for (const key of repoKeyHits) {
      discoveredKeys.add(key);
      await addIssueByKey(client, issuesByKey, key);
    }
  }

  const issueKeys = [...discoveredKeys];
  const keysJql = scopeJql(buildIssueKeysJql(issueKeys), options.integrationScope);
  if (keysJql && textSearchCount === 0 && issuesByKey.size < limit) {
    try {
      const keyHits = await client.searchIssues(keysJql, limit);
      for (const issue of keyHits) {
        issuesByKey.set(issue.key, issue);
      }
    } catch (error) {
      if (!searchError) {
        searchError = error instanceof Error ? error.message : "Jira search failed.";
      }
    }
  }

  const repoQuery = owner && repo ? `${owner}/${repo}` : options.repo?.trim();
  let searchNote: string | undefined;
  let matchStrategy: JiraSearchContext["matchStrategy"] = "none";

  if (textSearchCount > 0 || (focusJql && issuesByKey.size > 0)) {
    matchStrategy = "text";
  } else if (repoKeyHits?.length && issuesByKey.size > 0) {
    matchStrategy = "git";
    searchNote =
      "Tickets below were found via Jira issue keys referenced in recent commits or pull requests for this repository.";
  } else if (crossToolKeys.length > 0 && issuesByKey.size > 0) {
    matchStrategy = "cross-tool";
    searchNote =
      "Tickets below were found via Jira issue keys referenced in attached Confluence or Notion pages.";
  } else if (contextKeys.length > 0 && issuesByKey.size > 0) {
    matchStrategy = "key";
    searchNote =
      "Tickets below were found via Jira issue keys referenced in the active file or editor context.";
  } else if (issueKeys.length > 0 && issuesByKey.size > 0) {
    matchStrategy = "key";
  } else if (textSearchCount === 0 && issuesByKey.size === 0 && jql && !searchError) {
    searchNote =
      `No Jira tickets mention ${repoQuery ?? "this repository"} in summary or description, ` +
      "and no issue keys were found in recent git history or open files. " +
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

  const ranked = rankJiraIssuesForFocus(mapIssues([...issuesByKey.values()]), {
    activeFile: options.activeFile,
    queryText,
    extraTerms: options.extraTerms,
    owner: options.owner,
    repo: options.repo
  }).slice(0, limit);

  return {
    source: "jira-search",
    jql: jql ?? "",
    repoQuery,
    issues: filterScopedIssues(ranked, options.integrationScope),
    issueKeyHits: issueKeys.length > 0 ? issueKeys : undefined,
    repoKeyHits: repoKeyHits?.length ? repoKeyHits : undefined,
    matchStrategy,
    searchNote,
    error: searchError
  };
}

function buildRepoClause(owner: string | undefined, repo: string | undefined): string | undefined {
  const terms = buildRepoSearchTerms(owner, repo);
  if (terms.length === 0) {
    return undefined;
  }
  const clauses = new Set<string>();
  for (const term of terms) {
    clauses.add(`text ~ "${escapeJqlString(term)}"`);
    clauses.add(`summary ~ "${escapeJqlString(term)}"`);
  }
  return `(${[...clauses].join(" OR ")})`;
}

function scopeJql(
  jql: string | undefined,
  integrationScope: ResolvedIntegrationScope | undefined
): string | undefined {
  if (!jql?.trim()) {
    return jql;
  }
  if (!integrationScope?.enforced || !integrationScope.atlassian) {
    return jql;
  }
  return applyJiraProjectScope(
    [jql],
    integrationScope.atlassian.jiraProjectIds,
    integrationScope.atlassian.jiraProjectKeys
  )[0];
}

function filterScopedIssues(
  issues: JiraSearchTicket[],
  integrationScope: ResolvedIntegrationScope | undefined
): JiraSearchTicket[] {
  const keys = integrationScope?.atlassian?.jiraProjectKeys ?? [];
  if (!integrationScope?.enforced || keys.length === 0) {
    return issues;
  }
  return filterJiraIssuesByProject(
    issues,
    new Set(keys.map((key) => key.toUpperCase()))
  );
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
