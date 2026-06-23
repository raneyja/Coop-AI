import { TeamsClient } from "../api/teams/teamsClient";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";
import { buildRepoSearchQuery } from "./slackContext";
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

export async function fetchTeamsSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  queryText?: string;
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

  const query = buildRepoSearchQuery(options.owner, options.repo);
  if (!query) {
    return {
      source: "teams-search",
      query: "",
      messages: [],
      error: "Set repository owner and repo in Settings to search Teams by repo."
    };
  }

  const client = new TeamsClient({ accessToken: creds.teamsToken });
  try {
    const hits = await client.searchMessages(query, { limit: options.limit ?? 20 });
    const repoQuery =
      options.owner?.trim() && options.repo?.trim()
        ? `${options.owner.trim()}/${options.repo.trim()}`
        : options.repo?.trim();

    return {
      source: "teams-search",
      query,
      repoQuery,
      messages: hits.map((hit) => ({
        fromUserName: hit.fromUserName,
        body: truncate(hit.body, 500),
        createdAt: hit.createdAt,
        webUrl: hit.webUrl
      }))
    };
  } catch (error) {
    return {
      source: "teams-search",
      query,
      messages: [],
      error: error instanceof Error ? error.message : "Teams search failed."
    };
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}
