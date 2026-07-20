import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { CodeHostProvider } from "../api/codeHosts/types";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";
import type { ResolvedIntegrationScope, ScopedIntegrationProvider } from "../integrationScope/types";
import { fetchCodeHostSearchContext, shouldFetchCodeHostContext } from "./codeHostContext";
import { fetchConfluenceSearchContext, shouldFetchConfluenceContext } from "./confluenceContext";
import { fetchGoogleDocsSearchContext, shouldFetchGoogleDocsContext } from "./googleDocsContext";
import { fetchJiraSearchContext, shouldFetchJiraContext } from "./jiraContext";
import { hasLocalDiskContext, readLocalWorkspaceFiles } from "./localFileContext";
import { resolveLocalAbsolutePath } from "./localFileResolver";
import { fetchNotionSearchContext, shouldFetchNotionContext } from "./notionContext";
import { fetchSlackSearchContext, shouldFetchSlackContext } from "./slackContext";
import { fetchTeamsSearchContext, shouldFetchTeamsContext } from "./teamsContext";
import { shouldFetchTraceDecisionIntegrations, shouldFetchTraceDecisionSoftDocIntegrations } from "./integrationFetchPolicy";
import {
  buildIntegrationSearchTermList,
  collectCrossToolSearchText
} from "./integrationSearchTerms";
import { buildTraceDecisionSearchSeeds } from "./traceDecisionSearch";
import type { DecisionTimeline } from "../types/decisionTimeline";

type IntegrationChatEnrichmentDeps = {
  shouldFetchConfluenceContext: typeof shouldFetchConfluenceContext;
  fetchConfluenceSearchContext: typeof fetchConfluenceSearchContext;
  shouldFetchNotionContext: typeof shouldFetchNotionContext;
  fetchNotionSearchContext: typeof fetchNotionSearchContext;
  shouldFetchJiraContext: typeof shouldFetchJiraContext;
  fetchJiraSearchContext: typeof fetchJiraSearchContext;
  shouldFetchSlackContext: typeof shouldFetchSlackContext;
  fetchSlackSearchContext: typeof fetchSlackSearchContext;
  shouldFetchTeamsContext: typeof shouldFetchTeamsContext;
  fetchTeamsSearchContext: typeof fetchTeamsSearchContext;
  shouldFetchGoogleDocsContext: typeof shouldFetchGoogleDocsContext;
  fetchGoogleDocsSearchContext: typeof fetchGoogleDocsSearchContext;
  shouldFetchCodeHostContext: typeof shouldFetchCodeHostContext;
  fetchCodeHostSearchContext: typeof fetchCodeHostSearchContext;
};

const DEFAULT_INTEGRATION_CHAT_ENRICHMENT_DEPS: IntegrationChatEnrichmentDeps = {
  shouldFetchConfluenceContext,
  fetchConfluenceSearchContext,
  shouldFetchNotionContext,
  fetchNotionSearchContext,
  shouldFetchJiraContext,
  fetchJiraSearchContext,
  shouldFetchSlackContext,
  fetchSlackSearchContext,
  shouldFetchTeamsContext,
  fetchTeamsSearchContext,
  shouldFetchGoogleDocsContext,
  fetchGoogleDocsSearchContext,
  shouldFetchCodeHostContext,
  fetchCodeHostSearchContext
};

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
  integrationScopes?: Partial<Record<ScopedIntegrationProvider, ResolvedIntegrationScope>>;
  deps?: Partial<IntegrationChatEnrichmentDeps>;
  /**
   * When set, integration search is bounded to this many milliseconds. Whatever
   * completes within the budget is included; slower tools are dropped so a single
   * slow integration cannot block synthesis. In-flight fetches are abandoned, not
   * cancelled. When unset, all requested integrations are awaited to completion.
   */
  budgetMs?: number;
}): Promise<ContextFetchResult> {
  const data = asRecord(options.result.data);
  const deps = {
    ...DEFAULT_INTEGRATION_CHAT_ENRICHMENT_DEPS,
    ...options.deps
  };

  const runStages = (): Promise<void> => enrichIntegrationStages(options, data, deps);

  if (options.budgetMs !== undefined && options.budgetMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, options.budgetMs);
    });
    // Swallow late rejections so an abandoned fetch cannot raise unhandled errors.
    await Promise.race([runStages().catch(() => undefined), budget]);
    if (timer) {
      clearTimeout(timer);
    }
    // Snapshot so writes from still-in-flight fetches don't mutate the returned bundle.
    return { ...options.result, data: { ...data } };
  }

  await runStages();
  return { ...options.result, data };
}

async function enrichIntegrationStages(
  options: {
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
    integrationScopes?: Partial<Record<ScopedIntegrationProvider, ResolvedIntegrationScope>>;
  },
  data: Record<string, unknown>,
  deps: IntegrationChatEnrichmentDeps
): Promise<void> {
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

  const shouldFetchConfluence = deps.shouldFetchConfluenceContext(options.request);
  const timeline = asRecord(options.result.data).timeline as DecisionTimeline | undefined;
  const softDocs =
    !shouldFetchTraceDecisionIntegrations(options.request) ||
    shouldFetchTraceDecisionSoftDocIntegrations(options.request, timeline);
  const shouldFetchNotion = softDocs && deps.shouldFetchNotionContext(options.request);
  const [confluenceSearch, notionSearch] = await Promise.all([
    shouldFetchConfluence
      ? deps.fetchConfluenceSearchContext({
          secrets: options.secrets,
          owner: options.owner,
          repo: options.repo,
          extraTerms: integrationTerms,
          integrationScope: options.integrationScopes?.atlassian
        })
      : Promise.resolve(undefined),
    shouldFetchNotion
      ? deps.fetchNotionSearchContext({
          secrets: options.secrets,
          owner: options.owner,
          repo: options.repo,
          extraTerms: integrationTerms,
          integrationScope: options.integrationScopes?.notion
        })
      : Promise.resolve(undefined)
  ]);
  if (shouldFetchConfluence) {
    data.confluenceSearch = confluenceSearch;
  }
  if (shouldFetchNotion) {
    data.notionSearch = notionSearch;
  }

  const crossToolText = collectCrossToolSearchText(confluenceSearch, notionSearch);
  const crossToolKeys = crossToolText.length > 0 ? crossToolText : undefined;
  const docExtraTerms = [...integrationTerms, ...crossToolText];

  const shouldFetchJira = deps.shouldFetchJiraContext(options.request);
  const shouldFetchGoogleDocs = softDocs && deps.shouldFetchGoogleDocsContext(options.request);
  const [jiraSearch, googleDocsSearch] = await Promise.all([
    shouldFetchJira
      ? deps.fetchJiraSearchContext({
          secrets: options.secrets,
          ...base,
          crossToolText: crossToolKeys,
          codeHostRouter: options.codeHostRouter,
          codeHostConnected: options.codeHostConnected,
          integrationScope: options.integrationScopes?.atlassian
        })
      : Promise.resolve(undefined),
    shouldFetchGoogleDocs
      ? deps.fetchGoogleDocsSearchContext({
          secrets: options.secrets,
          ...base,
          crossToolText: crossToolKeys,
          extraTerms: docExtraTerms,
          integrationScope: options.integrationScopes?.["google-docs"]
        })
      : Promise.resolve(undefined)
  ]);
  if (shouldFetchJira) {
    data.jiraSearch = jiraSearch;
  }
  if (shouldFetchGoogleDocs) {
    data.googleDocsSearch = googleDocsSearch;
  }
  const jiraIssueKeys = (
    jiraSearch as { issues?: Array<{ key?: string }> } | undefined
  )?.issues
    ?.map((issue) => issue.key?.trim())
    .filter((key): key is string => Boolean(key));
  const shouldFetchSlack = deps.shouldFetchSlackContext(options.request);
  const shouldFetchTeams = deps.shouldFetchTeamsContext(options.request);
  const [slackSearch, teamsSearch] = await Promise.all([
    shouldFetchSlack
      ? deps.fetchSlackSearchContext({
          secrets: options.secrets,
          ...base,
          crossToolText: crossToolKeys,
          jiraIssueKeys,
          integrationScope: options.integrationScopes?.slack
        })
      : Promise.resolve(undefined),
    shouldFetchTeams
      ? deps.fetchTeamsSearchContext({
          secrets: options.secrets,
          ...base,
          crossToolText: crossToolKeys,
          jiraIssueKeys
        })
      : Promise.resolve(undefined)
  ]);
  if (shouldFetchSlack) {
    data.slackSearch = slackSearch;
  }
  if (shouldFetchTeams) {
    data.teamsSearch = teamsSearch;
  }
  if (deps.shouldFetchCodeHostContext(options.request) && options.codeHostConnected) {
    data.codeHostSearch = await deps.fetchCodeHostSearchContext({
      router: options.codeHostRouter,
      provider: options.codeHostProvider,
      ...base
    });
  }
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
