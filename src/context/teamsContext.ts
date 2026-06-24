import { TeamsClient } from "../api/teams/teamsClient";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";
import { buildDiscussionSearchQueries } from "./integrationSearchTerms";
import { shouldFetchDiscussionIntegrations } from "./integrationFetchPolicy";

export type TeamsSearchMessage = {
  fromUserName?: string;
  body: string;
  createdAt: string;
  webUrl?: string;
};

export type TeamsSearchContext = {
  source: "teams-search";
  query: string;
  repoQuery?: string;
  messages: TeamsSearchMessage[];
  /** Queries merged when multiple search strategies were used. */
  queries?: string[];
  error?: string;
};

export function wantsTeamsContext(query: string): boolean {
  const q = query.trim();
  if (!q) {
    return false;
  }
  if (/\bteams\b/i.test(q) || /\bmicrosoft teams\b/i.test(q)) {
    return true;
  }
  if (/\b(threads?|discussions?|messages?|conversations?)\b/i.test(q) && /\b(teams|repo|repository|this|channel)\b/i.test(q)) {
    return true;
  }
  return false;
}

export function shouldFetchTeamsContext(request: ContextFetchRequest): boolean {
  if (request.params.integrationProvider === "teams") {
    return true;
  }
  if (shouldFetchDiscussionIntegrations(request)) {
    return true;
  }
  if (request.type !== "chat_context") {
    return false;
  }
  return wantsTeamsContext(request.intent.context.queryText ?? "");
}

export function buildTeamsSearchQueries(options: {
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
  jiraIssueKeys?: string[];
}): string[] {
  return buildDiscussionSearchQueries(options);
}

export async function fetchTeamsSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
  jiraIssueKeys?: string[];
  limit?: number;
}): Promise<TeamsSearchContext> {
  const creds = await options.secrets.getCredentials();
  if (!creds.teamsToken) {
    return {
      source: "teams-search",
      query: "",
      messages: [],
      error: "Microsoft Teams token not configured."
    };
  }

  const queries = buildTeamsSearchQueries(options);
  const query = queries[0] ?? "";
  if (!query) {
    return {
      source: "teams-search",
      query: "",
      messages: [],
      error: "Set repository owner and repo in Settings to search Teams by repo."
    };
  }

  const client = new TeamsClient({ accessToken: creds.teamsToken });
  const limit = options.limit ?? 20;
  const seen = new Map<string, TeamsSearchMessage>();
  const errors: string[] = [];

  for (const searchQuery of queries.slice(0, 16)) {
    if (seen.size >= limit) {
      break;
    }
    try {
      const hits = await client.searchMessages(searchQuery, { limit: limit - seen.size });
      for (const hit of hits) {
        const key = `${hit.teamId}:${hit.channelId}:${hit.messageId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.set(key, {
          fromUserName: hit.fromUserName,
          body: truncate(hit.body, 500),
          createdAt: hit.createdAt,
          webUrl: hit.webUrl
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Teams search failed.";
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
    source: "teams-search",
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
