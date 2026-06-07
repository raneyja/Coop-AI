import { SlackClient } from "../api/slack/slackClient";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest } from "./requestBatcher";

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
  if (request.type !== "chat_context") {
    return false;
  }
  return wantsSlackContext(request.intent.context.queryText ?? "");
}

export function buildRepoSearchQuery(owner: string | undefined, repo: string | undefined): string | undefined {
  const repoName = repo?.trim();
  if (!repoName) {
    return undefined;
  }
  const terms: string[] = [];
  const ownerName = owner?.trim();
  if (ownerName) {
    terms.push(`${ownerName}/${repoName}`);
    terms.push(`github:${ownerName}/${repoName}`);
  }
  terms.push(repoName);
  return terms.join(" OR ");
}

export async function fetchSlackSearchContext(options: {
  secrets: IntegrationSecrets;
  owner?: string;
  repo?: string;
  queryText?: string;
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

  const query = buildRepoSearchQuery(options.owner, options.repo);
  if (!query) {
    return {
      source: "slack-search",
      query: "",
      messages: [],
      error: "Set repository owner and repo in Settings to search Slack by repo."
    };
  }

  const client = new SlackClient({ token: creds.slackToken });
  try {
    const hits = await client.searchMessages(query, { limit: options.limit ?? 20 });
    const repoQuery =
      options.owner?.trim() && options.repo?.trim()
        ? `${options.owner.trim()}/${options.repo.trim()}`
        : options.repo?.trim();

    return {
      source: "slack-search",
      query,
      repoQuery,
      messages: hits.map((hit) => ({
        channelName: hit.channelName,
        userName: hit.userName,
        text: truncate(hit.text, 500),
        ts: hit.ts,
        permalink: hit.permalink
      }))
    };
  } catch (error) {
    return {
      source: "slack-search",
      query,
      messages: [],
      error: error instanceof Error ? error.message : "Slack search failed."
    };
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}
