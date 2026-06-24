import { SlackClient } from "../api/slack/slackClient";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";
import { buildRepoSearchTerms } from "./docSearchQuery";
import { collectJiraKeysFromText } from "./jiraContext";
import { buildDiscussionSearchQueries } from "./integrationSearchTerms";
import { filePathSearchTerms } from "./traceDecisionSearch";
import { shouldFetchDiscussionIntegrations } from "./integrationFetchPolicy";

export type SlackSearchMessage = {
  channelName?: string;
  userName?: string;
  text: string;
  ts: string;
  permalink?: string;
};

export type SlackSearchContext = {
  source: "slack-search";
  query: string;
  repoQuery?: string;
  messages: SlackSearchMessage[];
  /** Queries merged when multiple search strategies were used. */
  queries?: string[];
  error?: string;
};

export function wantsSlackContext(query: string): boolean {
  const q = query.trim();
  if (!q) {
    return false;
  }
  if (/\bslack\b/i.test(q)) {
    return true;
  }
  if (/\b(threads?|discussions?|messages?|conversations?)\b/i.test(q) && /\b(slack|repo|repository|this|channel)\b/i.test(q)) {
    return true;
  }
  return false;
}

export function shouldFetchSlackContext(request: ContextFetchRequest): boolean {
  if (request.params.integrationProvider === "slack") {
    return true;
  }
  if (shouldFetchDiscussionIntegrations(request)) {
    return true;
  }
  if (request.type !== "chat_context") {
    return false;
  }
  return wantsSlackContext(request.intent.context.queryText ?? "");
}

export function buildRepoSearchQuery(owner: string | undefined, repo: string | undefined): string | undefined {
  const terms = buildRepoSearchTerms(owner, repo);
  return terms.length > 0 ? terms.join(" OR ") : undefined;
}

export function buildSlackSearchQuery(options: {
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
}): string | undefined {
  const terms = new Set<string>();

  for (const term of buildRepoSearchTerms(options.owner, options.repo)) {
    terms.add(term);
  }

  for (const term of filePathSearchTerms(options.activeFile)) {
    terms.add(term);
  }

  const activeFile = options.activeFile?.trim();
  if (activeFile) {
    terms.add(activeFile);
    const basename = activeFile.split("/").pop();
    if (basename) {
      terms.add(basename);
    }
  }

  for (const key of collectJiraKeysFromText(
    options.queryText,
    ...(options.contextText ?? []),
    ...(options.crossToolText ?? [])
  )) {
    terms.add(key);
  }

  if (options.queryText?.trim()) {
    for (const part of options.queryText.split(/\s+OR\s+/i)) {
      const trimmed = part.trim();
      if (trimmed) {
        terms.add(trimmed);
      }
    }
  }

  return terms.size > 0 ? [...terms].join(" OR ") : undefined;
}

/** Multiple Slack search strategies for repo-wide discovery (deduped at fetch time). */
export function buildSlackSearchQueries(options: {
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
  jiraIssueKeys?: string[];
}): string[] {
  return buildDiscussionSearchQueries({ ...options, threadModifier: "is:thread" });
}

export async function fetchSlackSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
  jiraIssueKeys?: string[];
  limit?: number;
}): Promise<SlackSearchContext> {
  const creds = await options.secrets.getCredentials();
  if (!creds.slackToken) {
    return {
      source: "slack-search",
      query: "",
      messages: [],
      error: "Slack token not configured."
    };
  }

  const queries = buildSlackSearchQueries(options);
  const query = queries[0] ?? "";
  if (!query) {
    return {
      source: "slack-search",
      query: "",
      messages: [],
      error: "Set repository owner and repo in Settings to search Slack by repo."
    };
  }

  const client = new SlackClient({ token: creds.slackToken });
  const limit = options.limit ?? 20;
  const perQueryLimit = Math.max(5, Math.ceil(limit / Math.min(queries.length, 4)));
  const seen = new Map<string, SlackSearchMessage>();
  const errors: string[] = [];

  for (const searchQuery of queries.slice(0, 16)) {
    if (seen.size >= limit) {
      break;
    }
    try {
      await mergeSlackHits(client, searchQuery, seen, limit, perQueryLimit);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slack search failed.";
      if (!errors.includes(message)) {
        errors.push(message);
      }
    }
  }

  const repoQuery =
    options.owner?.trim() && options.repo?.trim()
      ? `${options.owner.trim()}/${options.repo.trim()}`
      : options.repo?.trim();

  return {
    source: "slack-search",
    query,
    queries: queries.length > 1 ? queries : undefined,
    repoQuery,
    messages: [...seen.values()].slice(0, limit),
    error: seen.size === 0 && errors.length > 0 ? errors[0] : undefined
  };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

async function mergeSlackHits(
  client: SlackClient,
  searchQuery: string,
  seen: Map<string, SlackSearchMessage>,
  limit: number,
  perQueryLimit: number
): Promise<void> {
  const hits = await client.searchMessages(searchQuery, {
    limit: Math.min(perQueryLimit, limit - seen.size)
  });
  for (const hit of hits) {
    const key = `${hit.channelId}:${hit.ts}`;
    if (seen.has(key)) {
      continue;
    }
    seen.set(key, {
      channelName: hit.channelName,
      userName: hit.userName,
      text: truncate(hit.text, 500),
      ts: hit.ts,
      permalink: hit.permalink
    });
  }
}
