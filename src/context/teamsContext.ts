import { TeamsClient, type TeamsSearchHit, type TeamsThread } from "../api/teams/teamsClient";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import {
  filterTeamsHitsByChannel,
  isTeamsScopeBlocked,
  teamsScopeBlockMessage
} from "../integrationScope/teamsQuery";
import type { ContextFetchRequest } from "./requestBatcher";
import { buildDiscussionSearchQueries } from "./integrationSearchTerms";
import { shouldFetchIncidentIntegrations } from "./incidentIntent";
import { shouldFetchDiscussionIntegrations } from "./integrationFetchPolicy";
import { shouldFetchIntegrationWithAllowlist } from "./fetchIntegrationsAllowlist";
import { isTeamsComingSoon } from "../integrations/teamsAvailability";
import { sanitizeIntegrationSnippet } from "./integrationDocRelevance";
import type { ChatIntentJobVerb } from "../chat/intentPlanner/types";
import {
  emptySearchTopicError,
  latestUnsupportedError,
  missingRepoSearchError
} from "./integrationJobErrors";

export type TeamsSearchMessage = {
  teamId?: string;
  channelId?: string;
  messageId?: string;
  fromUserName?: string;
  body: string;
  createdAt: string;
  webUrl?: string;
  /** True when body was replaced with a full thread via getThread. */
  threadOpened?: boolean;
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

/** Injectable Teams client for tests — production uses credentials. */
export type TeamsSearchClient = {
  searchMessages(
    query: string,
    options?: { limit?: number }
  ): Promise<TeamsSearchHit[]>;
  getThread?(teamId: string, channelId: string, messageId: string): Promise<TeamsThread>;
};

export function wantsTeamsContext(query: string): boolean {
  const q = query.trim();
  if (!q) {
    return false;
  }
  // Require an explicit Teams product mention. "discussions about this" is Slack-shaped
  // and must not also plan Microsoft Teams when the user only named Slack.
  return /\b(ms\s*)?teams\b/i.test(q) || /\bmicrosoft\s+teams\b/i.test(q);
}

export function shouldFetchTeamsContext(request: ContextFetchRequest): boolean {
  if (isTeamsComingSoon()) {
    return false;
  }
  return shouldFetchIntegrationWithAllowlist(request, "teams", () => {
    if (shouldFetchDiscussionIntegrations(request)) {
      return true;
    }
    if (request.type !== "chat_context") {
      return false;
    }
    const queryText = request.intent.context.queryText ?? "";
    if (shouldFetchIncidentIntegrations(queryText)) {
      return true;
    }
    return wantsTeamsContext(queryText);
  });
}

export function buildTeamsSearchQueries(options: {
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  crossToolText?: string[];
  extraTerms?: string[];
  jiraIssueKeys?: string[];
  preferHost?: import("../api/codeHosts/types").CodeHostProvider;
  jobScoped?: boolean;
  jobVerb?: ChatIntentJobVerb;
}): string[] {
  return buildDiscussionSearchQueries({
    ...options,
    extraTerms: options.extraTerms?.map(quoteTeamsQueryTerm).filter(Boolean)
  });
}

/** Graph treats a bare hyphen as NOT and `not` as an operator. Quotes make both literal. */
export function quoteTeamsQueryTerm(term: string): string {
  const trimmed = term.trim().replace(/"/g, "");
  return trimmed ? `"${trimmed}"` : "";
}

export async function fetchTeamsSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  queryText?: string;
  activeFile?: string;
  contextText?: string[];
  extraTerms?: string[];
  crossToolText?: string[];
  jiraIssueKeys?: string[];
  preferHost?: import("../api/codeHosts/types").CodeHostProvider;
  limit?: number;
  jobScoped?: boolean;
  jobVerb?: ChatIntentJobVerb;
  integrationScope?: ResolvedIntegrationScope;
  /** Test seam — production leaves this unset and builds a client from secrets. */
  client?: TeamsSearchClient;
  /** Repo-wide Gaps: open threads after a hit. */
  openAfterHit?: boolean;
}): Promise<TeamsSearchContext> {
  // Injected clients (gates) exercise the open-thread path while product is coming-soon.
  if (isTeamsComingSoon() && !options.client) {
    return {
      source: "teams-search",
      query: "",
      messages: [],
      error: options.jobVerb === "latest" ? latestUnsupportedError("Microsoft Teams") : undefined
    };
  }
  if (options.jobVerb === "latest") {
    return {
      source: "teams-search",
      query: "",
      messages: [],
      error: latestUnsupportedError("Microsoft Teams")
    };
  }
  if (isTeamsScopeBlocked(options.integrationScope)) {
    return {
      source: "teams-search",
      query: "",
      messages: [],
      error: teamsScopeBlockMessage(options.integrationScope)
    };
  }

  const creds = await options.secrets.getCredentials();
  if (!creds.teamsToken && !options.client) {
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
      error: options.jobScoped ? emptySearchTopicError("Microsoft Teams") : missingRepoSearchError("Microsoft Teams")
    };
  }

  const client =
    options.client ??
    new TeamsClient({ accessToken: creds.teamsToken! });
  const limit = options.limit ?? 20;
  const seen = new Map<string, TeamsSearchMessage>();
  const errors: string[] = [];
  const allowedChannels = new Set(options.integrationScope?.teams?.channelIds ?? []);

  for (const searchQuery of queries.slice(0, 16)) {
    if (seen.size >= limit) {
      break;
    }
    try {
      const hits = await client.searchMessages(searchQuery, { limit: limit - seen.size });
      const scopedHits =
        allowedChannels.size > 0 ? filterTeamsHitsByChannel(hits, allowedChannels) : hits;
      for (const hit of scopedHits) {
        const key = `${hit.teamId}:${hit.channelId}:${hit.messageId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.set(key, {
          teamId: hit.teamId,
          channelId: hit.channelId,
          messageId: hit.messageId,
          fromUserName: hit.fromUserName,
          body: truncate(hit.body, 500),
          createdAt: hit.createdAt,
          webUrl: hit.webUrl
        });
      }
      if (options.jobScoped && seen.size > 0) {
        break;
      }
    } catch (error) {
      const message = explainTeamsSearchError(
        error instanceof Error ? error.message : "Teams search failed."
      );
      if (!errors.includes(message)) {
        errors.push(message);
      }
    }
  }

  const messages = await attachTeamsThreadBodies(
    client,
    [...seen.values()].slice(0, limit),
    { jobScoped: Boolean(options.jobScoped || options.openAfterHit) }
  );

  const repoQuery =
    options.owner?.trim() && options.repo?.trim()
      ? `${options.owner.trim()}/${options.repo.trim()}`
      : options.repo?.trim();

  return {
    source: "teams-search",
    query,
    queries: queries.length > 1 ? queries : undefined,
    repoQuery,
    messages,
    error: messages.length === 0 && errors.length > 0 ? errors[0] : undefined
  };
}

export function explainTeamsSearchError(message: string): string {
  if (/Chat\.Read/i.test(message)) {
    return "Teams is connected, but search needs Chat.Read. Disconnect and Connect Teams again in Settings after that permission is live.";
  }
  return message;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

const OPENED_THREAD_BODY_CHARS = 1500;
const MAX_OPENED_THREADS = 3;

async function attachTeamsThreadBodies(
  client: TeamsSearchClient,
  messages: TeamsSearchMessage[],
  options: { jobScoped: boolean }
): Promise<TeamsSearchMessage[]> {
  if (messages.length === 0 || !options.jobScoped || !client.getThread) {
    return messages;
  }
  const selected = messages.slice(0, MAX_OPENED_THREADS);
  const opened = await Promise.all(
    selected.map(async (message) => {
      try {
        const teamId = message.teamId?.trim();
        const channelId = message.channelId?.trim();
        const messageId = message.messageId?.trim();
        if (!teamId || !channelId || !messageId) {
          return { key: teamsMessageKey(message), body: undefined };
        }
        const thread = await client.getThread?.(teamId, channelId, messageId);
        if (!thread?.messages?.length) {
          return { key: teamsMessageKey(message), body: undefined };
        }
        const raw = thread.messages
          .map((entry) => {
            const who = entry.fromUserName ?? entry.fromUserId ?? "unknown";
            return `${who}: ${entry.body}`;
          })
          .join("\n");
        return { key: teamsMessageKey(message), body: raw };
      } catch {
        return { key: teamsMessageKey(message), body: undefined };
      }
    })
  );
  const byKey = new Map(opened.map((entry) => [entry.key, entry.body]));
  return messages.map((message) => {
    const raw = byKey.get(teamsMessageKey(message));
    if (!raw?.trim()) {
      return message;
    }
    const body = sanitizeIntegrationSnippet(truncate(raw, OPENED_THREAD_BODY_CHARS));
    return body ? { ...message, body, threadOpened: true } : message;
  });
}

function teamsMessageKey(message: TeamsSearchMessage): string {
  return `${message.teamId ?? ""}:${message.channelId ?? ""}:${message.messageId ?? ""}`;
}
