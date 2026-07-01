import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { CodeHostProvider } from "../api/codeHosts/types";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";
import type { ResolvedIntegrationScope } from "../integrationScope/types";
import { fetchCodeHostSearchContext, shouldFetchCodeHostContext } from "./codeHostContext";
import { fetchConfluenceSearchContext, shouldFetchConfluenceContext } from "./confluenceContext";
import { fetchGoogleDocsSearchContext, shouldFetchGoogleDocsContext } from "./googleDocsContext";
import { fetchJiraSearchContext, shouldFetchJiraContext } from "./jiraContext";
import { hasLocalDiskContext, readLocalWorkspaceFiles } from "./localFileContext";
import { resolveLocalAbsolutePath } from "./localFileResolver";
import { fetchNotionSearchContext, shouldFetchNotionContext } from "./notionContext";
import { fetchSlackSearchContext, shouldFetchSlackContext } from "./slackContext";
import { fetchTeamsSearchContext, shouldFetchTeamsContext } from "./teamsContext";
import { shouldFetchTraceDecisionIntegrations } from "./integrationFetchPolicy";
import {
  buildIntegrationSearchTermList,
  collectCrossToolSearchText
} from "./integrationSearchTerms";
import { buildTraceDecisionSearchSeeds } from "./traceDecisionSearch";
import type { DecisionTimeline } from "../types/decisionTimeline";

export async function enrichChatContextWithIntegrations(options: {
  result: ContextFetchResult;
  request: ContextFetchRequest;
  secrets: IntegrationSecrets;
  codeHostRouter: CodeHostRouter;
  owner?: string;
  repo?: string;
  activeFile?: string;
  contextText?: string[];
  codeHostProvider?: CodeHostProvider;
  codeHostConnected?: boolean;
  integrationScopes?: Partial<Record<"slack", ResolvedIntegrationScope>>;
}): Promise<ContextFetchResult> {
  const data = asRecord(options.result.data);
  const traceSeeds = await resolveTraceDecisionSearchSeeds(options);
  const base = {
    owner: options.owner,
    repo: options.repo,
    queryText: traceSeeds?.queryText ?? options.request.intent.context.queryText,
    activeFile: options.activeFile ?? options.request.params.file,
    contextText: options.contextText
  };
  const integrationTerms = buildIntegrationSearchTermList({
    ...base,
    extraTerms: traceSeeds?.searchTerms
  });

  let confluenceSearch: Awaited<ReturnType<typeof fetchConfluenceSearchContext>> | undefined;
  if (shouldFetchConfluenceContext(options.request)) {
    confluenceSearch = await fetchConfluenceSearchContext({
      secrets: options.secrets,
      owner: options.owner,
      repo: options.repo,
      extraTerms: integrationTerms
    });
    data.confluenceSearch = confluenceSearch;
  }

  let notionSearch: Awaited<ReturnType<typeof fetchNotionSearchContext>> | undefined;
  if (shouldFetchNotionContext(options.request)) {
    notionSearch = await fetchNotionSearchContext({
      secrets: options.secrets,
      owner: options.owner,
      repo: options.repo,
      extraTerms: integrationTerms
    });
    data.notionSearch = notionSearch;
  }

  const crossToolText = collectCrossToolSearchText(confluenceSearch, notionSearch);
  const crossToolKeys = crossToolText.length > 0 ? crossToolText : undefined;
  const docExtraTerms = [...integrationTerms, ...crossToolText];

  if (shouldFetchJiraContext(options.request)) {
    data.jiraSearch = await fetchJiraSearchContext({
      secrets: options.secrets,
      ...base,
      crossToolText: crossToolKeys,
      codeHostRouter: options.codeHostRouter,
      codeHostConnected: options.codeHostConnected
    });
  }
  const jiraIssueKeys = (
    data.jiraSearch as { issues?: Array<{ key?: string }> } | undefined
  )?.issues
    ?.map((issue) => issue.key?.trim())
    .filter((key): key is string => Boolean(key));
  if (shouldFetchSlackContext(options.request)) {
    data.slackSearch = await fetchSlackSearchContext({
      secrets: options.secrets,
      ...base,
      crossToolText: crossToolKeys,
      jiraIssueKeys,
      integrationScope: options.integrationScopes?.slack
    });
  }
  if (shouldFetchTeamsContext(options.request)) {
    data.teamsSearch = await fetchTeamsSearchContext({
      secrets: options.secrets,
      ...base,
      crossToolText: crossToolKeys,
      jiraIssueKeys
    });
  }
  if (shouldFetchGoogleDocsContext(options.request)) {
    data.googleDocsSearch = await fetchGoogleDocsSearchContext({
      secrets: options.secrets,
      ...base,
      crossToolText: crossToolKeys,
      extraTerms: docExtraTerms
    });
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

async function resolveTraceDecisionSearchSeeds(options: {
  result: ContextFetchResult;
  request: ContextFetchRequest;
}): Promise<ReturnType<typeof buildTraceDecisionSearchSeeds> | undefined> {
  if (!shouldFetchTraceDecisionIntegrations(options.request) || options.request.type !== "decision_history") {
    return undefined;
  }

  const timeline = asRecord(options.result.data).timeline as DecisionTimeline | undefined;
  if (!timeline) {
    return undefined;
  }

  const file = options.request.params.file ?? timeline.file;
  let fileContent: string | undefined;
  if (file && hasLocalDiskContext(options.request.params)) {
    try {
      const local = await readLocalWorkspaceFiles({
        file,
        fileSource: options.request.params.fileSource,
        openEditors: options.request.intent.context.openEditors,
        lines: options.request.params.lines,
        resolveAbsolutePath: resolveLocalAbsolutePath
      });
      fileContent = local?.files.map((entry) => entry.content).join("\n");
    } catch {
      /* optional local read */
    }
  }

  return buildTraceDecisionSearchSeeds(timeline, file, fileContent);
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
