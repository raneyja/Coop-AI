import { SlackClient } from "../api/slack/slackClient";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import {
  applySlackChannelScope,
  slackSearchTerm,
  filterSlackHitsByChannel,
  isSlackScopeBlocked,
  MAX_JOB_SCOPED_SLACK_QUERIES,
  scopeJobSlackSearchQueries,
  slackScopeBlockMessage,
  stripSlackSearchOperators
} from "../integrationScope/slackQuery";
import type { CodeHostProvider } from "../api/codeHosts/types";
import { buildRepoSearchTerms } from "./docSearchQuery";
import { collectJiraKeysFromText } from "./jiraContext";
import { buildDiscussionSearchQueries } from "./integrationSearchTerms";
import { exactIssueKeys, planJobSearchAttempts } from "./jobSearchPlan";
import { filePathSearchTerms } from "./traceDecisionSearch";
import { shouldFetchIncidentIntegrations } from "./incidentIntent";
import { shouldFetchDiscussionIntegrations } from "./integrationFetchPolicy";
import { shouldFetchIntegrationWithAllowlist } from "./fetchIntegrationsAllowlist";

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
  return shouldFetchIntegrationWithAllowlist(request, "slack", () => {
    if (shouldFetchDiscussionIntegrations(request)) {
      return true;
    }
    if (request.type !== "chat_context") {
      return false;
    }
    const queryText = request.intent.context.queryText ?? "";
    // Incident / on-call reconstruction (A9) — fetch even when the user did not say "slack".
    if (shouldFetchIncidentIntegrations(queryText)) {
      return true;
    }
    return wantsSlackContext(queryText);
  });
}

export function buildRepoSearchQuery(
  owner: string | undefined,
  repo: string | undefined,
  preferHost?: CodeHostProvider
): string | undefined {
  const terms = buildRepoSearchTerms(owner, repo, { preferHost });
  return terms.length > 0 ? terms.join(" OR ") : undefined;
}

export function buildSlackSearchQuery(options: {
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
  preferHost?: CodeHostProvider;
}): string | undefined {
  const terms = new Set<string>();

  for (const term of buildRepoSearchTerms(options.owner, options.repo, {
    preferHost: options.preferHost
  })) {
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
  extraTerms?: string[];
  jiraIssueKeys?: string[];
  preferHost?: CodeHostProvider;
  jobScoped?: boolean;
}): string[] {
  if (options.jobScoped) {
    const terms = (options.extraTerms ?? []).map((term) => stripSlackSearchOperators(term));
    const keys = exactIssueKeys(terms);
    const attempts = planJobSearchAttempts(terms)
      .map((attempt) => slackSearchTerm(attempt.text))
      .filter(Boolean);
    return [...keys, ...attempts].slice(0, MAX_JOB_SCOPED_SLACK_QUERIES);
  }
  return buildDiscussionSearchQueries({
    ...options,
    extraTerms: options.extraTerms?.map(slackSearchTerm).filter(Boolean),
    threadModifier: "is:thread"
  });
}

/**
 * Job Slack searches Coop will actually send. Enforced allowlists are attached
 * here so the fetch path cannot skip them and search the workspace.
 */
export function planJobSlackSearchQueries(options: {
  extraTerms?: string[];
  integrationScope?: ResolvedIntegrationScope;
}): string[] {
  return scopeJobSlackSearchQueries(
    buildSlackSearchQueries({
      extraTerms: options.extraTerms,
      jobScoped: true
    }),
    options.integrationScope?.slack?.channelIds ?? [],
    options.integrationScope?.slack?.channelNames ?? [],
    { enforced: Boolean(options.integrationScope?.enforced) }
  );
}

export async function fetchSlackSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
  extraTerms?: string[];
  jiraIssueKeys?: string[];
  preferHost?: CodeHostProvider;
  limit?: number;
  integrationScope?: ResolvedIntegrationScope;
  jobScoped?: boolean;
}): Promise<SlackSearchContext> {
  if (isSlackScopeBlocked(options.integrationScope)) {
    return {
      source: "slack-search",
      query: "",
      messages: [],
      error: slackScopeBlockMessage(options.integrationScope)
    };
  }

  const creds = await options.secrets.getCredentials();
  if (!creds.slackToken) {
    return {
      source: "slack-search",
      query: "",
      messages: [],
      error: "Slack token not configured."
    };
  }

  const queries = options.jobScoped
    ? planJobSlackSearchQueries({
        extraTerms: options.extraTerms,
        integrationScope: options.integrationScope
      })
    : buildSlackSearchQueries(options);
  const scopedQueries =
    options.jobScoped
      ? queries
      : options.integrationScope?.enforced && options.integrationScope.slack
        ? applySlackChannelScope(
            queries,
            options.integrationScope.slack.channelIds,
            options.integrationScope.slack.channelNames
          )
        : queries;
  const query = scopedQueries[0] ?? "";
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
  const runQueries = scopedQueries.slice(
    0,
    options.jobScoped ? MAX_JOB_SCOPED_SLACK_QUERIES : 16
  );
  const perQueryLimit = Math.max(5, Math.ceil(limit / Math.min(runQueries.length, 4)));
  const seen = new Map<string, SlackSearchMessage>();
  const errors: string[] = [];

  const allowedChannels = new Set(options.integrationScope?.slack?.channelIds ?? []);

  for (const searchQuery of runQueries) {
    if (seen.size >= limit) {
      break;
    }
    try {
      await mergeSlackHits(client, searchQuery, seen, limit, perQueryLimit, allowedChannels);
      // A hit spends the cap. Do not keep calling Slack after allowlisted messages exist.
      if (options.jobScoped && seen.size > 0) {
        break;
      }
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
    queries: scopedQueries.length > 1 ? scopedQueries : undefined,
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
  perQueryLimit: number,
  allowedChannelIds: Set<string> = new Set()
): Promise<void> {
  const hits = await client.searchMessages(searchQuery, {
    limit: Math.min(perQueryLimit, limit - seen.size)
  });
  const scopedHits =
    allowedChannelIds.size > 0
      ? filterSlackHitsByChannel(
          hits.map((hit) => ({ ...hit, channelId: hit.channelId })),
          allowedChannelIds
        )
      : hits;
  for (const hit of scopedHits) {
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
