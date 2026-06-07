import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { CodeHostProvider } from "../api/codeHosts/types";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";
import { fetchCodeHostSearchContext, shouldFetchCodeHostContext } from "./codeHostContext";
import { fetchConfluenceSearchContext, shouldFetchConfluenceContext } from "./confluenceContext";
import { fetchGoogleDocsSearchContext, shouldFetchGoogleDocsContext } from "./googleDocsContext";
import { fetchJiraSearchContext, shouldFetchJiraContext } from "./jiraContext";
import { fetchNotionSearchContext, shouldFetchNotionContext } from "./notionContext";
import { fetchSlackSearchContext, shouldFetchSlackContext } from "./slackContext";
import { fetchTeamsSearchContext, shouldFetchTeamsContext } from "./teamsContext";

export async function enrichChatContextWithIntegrations(options: {
  result: ContextFetchResult;
  request: ContextFetchRequest;
  secrets: IntegrationSecrets;
  codeHostRouter: CodeHostRouter;
  owner?: string;
  repo?: string;
  codeHostProvider?: CodeHostProvider;
  codeHostConnected?: boolean;
}): Promise<ContextFetchResult> {
  const data = asRecord(options.result.data);
  const base = {
    owner: options.owner,
    repo: options.repo,
    queryText: options.request.intent.context.queryText
  };

  if (shouldFetchJiraContext(options.request)) {
    data.jiraSearch = await fetchJiraSearchContext({
      secrets: options.secrets,
      ...base,
      codeHostRouter: options.codeHostRouter,
      codeHostConnected: options.codeHostConnected
    });
  }
  if (shouldFetchSlackContext(options.request)) {
    data.slackSearch = await fetchSlackSearchContext({ secrets: options.secrets, ...base });
  }
  if (shouldFetchTeamsContext(options.request)) {
    data.teamsSearch = await fetchTeamsSearchContext({ secrets: options.secrets, ...base });
  }
  if (shouldFetchConfluenceContext(options.request)) {
    data.confluenceSearch = await fetchConfluenceSearchContext({ secrets: options.secrets, ...base });
  }
  if (shouldFetchNotionContext(options.request)) {
    data.notionSearch = await fetchNotionSearchContext({ secrets: options.secrets, ...base });
  }
  if (shouldFetchGoogleDocsContext(options.request)) {
    data.googleDocsSearch = await fetchGoogleDocsSearchContext({ secrets: options.secrets, ...base });
  }
  if (shouldFetchCodeHostContext(options.request) && options.codeHostConnected) {
    data.codeHostSearch = await fetchCodeHostSearchContext({
      router: options.codeHostRouter,
      provider: options.codeHostProvider,
      ...base
    });
  }

  return { ...options.result, data };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? { ...(value as Record<string, unknown>) } : {};
}

export function contextBundleHasIntegrationSearch(
  bundle: Array<{ data?: unknown }>
): boolean {
  return bundle.some((entry) => {
    const data = asRecord(entry.data);
    return Boolean(
      data.jiraSearch ||
        data.slackSearch ||
        data.teamsSearch ||
        data.confluenceSearch ||
        data.notionSearch ||
        data.googleDocsSearch ||
        data.codeHostSearch
    );
  });
}
