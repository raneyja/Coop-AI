import type { CodeHostRouter } from "../api/codeHosts/codeHostRouter";
import type { CodeHostProvider } from "../api/codeHosts/types";
import type { IntegrationSecrets } from "../api/integrations/integrationSecrets";
import type { ContextFetchRequest, ContextFetchResult } from "./requestBatcher";
import type { ResolvedIntegrationScope, ScopedIntegrationProvider } from "../integrationScope/types";
import { fetchCodeHostSearchContext, shouldFetchCodeHostContext } from "./codeHostContext";
import { fetchConfluenceSearchContext, shouldFetchConfluenceContext } from "./confluenceContext";
import { fetchGoogleDocsSearchContext, shouldFetchGoogleDocsContext } from "./googleDocsContext";
import { fetchJiraSearchContext, shouldFetchJiraContext } from "./jiraContext";
import { fetchNotionSearchContext, shouldFetchNotionContext } from "./notionContext";
import { fetchSlackSearchContext, shouldFetchSlackContext } from "./slackContext";
import { fetchTeamsSearchContext, shouldFetchTeamsContext } from "./teamsContext";
import { shouldFetchTraceDecisionIntegrations } from "./integrationFetchPolicy";
import { requestAllowsIntegrationFetch } from "./fetchIntegrationsAllowlist";
import type { IntegrationChatProvider } from "../chat/types";
import {
  buildIntegrationSearchTermList,
  collectCrossToolSearchText
} from "./integrationSearchTerms";
import { buildTraceDecisionSearchSeeds } from "./traceDecisionSearch";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  formatIntegrationHitDetail,
  integrationCompletedActivityLabel,
  integrationRunningActivityLabel,
  preferredIntegrationActivityQuery,
  type IntegrationActivityTool,
  type IntegrationToolActivityEvent
} from "./integrationActivityLabels";

/** Connected flags — keep local to avoid importing chat/UI modules into this hot path. */
export type IntegrationConnectedFlags = {
  jira?: boolean;
  slack?: boolean;
  teams?: boolean;
  confluence?: boolean;
  notion?: boolean;
  googleDocs?: boolean;
};

type IntegrationEnrichmentOptions = {
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
  /** When set, only run tools that are connected (matches thinking UI). */
  integrations?: IntegrationConnectedFlags;
  integrationScopes?: Partial<Record<ScopedIntegrationProvider, ResolvedIntegrationScope>>;
  extraSearchTerms?: string[];
  /** Fired when a real integration fetch starts/finishes — drives thinking UI. */
  onToolActivity?: (event: IntegrationToolActivityEvent) => void;
  deps?: Partial<IntegrationChatEnrichmentDeps>;
  budgetMs?: number;
};

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

export async function enrichChatContextWithIntegrations(
  options: IntegrationEnrichmentOptions
): Promise<ContextFetchResult> {
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
  options: IntegrationEnrichmentOptions,
  data: Record<string, unknown>,
  deps: IntegrationChatEnrichmentDeps
): Promise<void> {
  const traceSeeds = await resolveTraceDecisionSearchSeeds(options);
  const base = {
    owner: options.owner,
    repo: options.repo,
    queryText: traceSeeds?.queryText ?? options.request.intent.context.queryText,
    // Prefer caller-supplied activeFile (may be cleared when Gaps focus demotes an unrelated chip).
    activeFile: options.activeFile !== undefined ? options.activeFile : options.request.params.file,
    contextText: options.contextText
  };
  const integrationTerms = buildIntegrationSearchTermList({
    ...base,
    // Focus / caller terms first so they survive the term cap ahead of file basenames.
    extraTerms: [...(options.extraSearchTerms ?? []), ...(traceSeeds?.searchTerms ?? [])]
  });
  const codeHostProvider = options.codeHostProvider ?? "github";
  const activityQuery = preferredIntegrationActivityQuery(integrationTerms);
  const notify = (
    tool: IntegrationActivityTool,
    phase: "start" | "done",
    extra?: { query?: string; hits?: string[]; error?: string }
  ) => {
    const query = extra?.query ?? activityQuery;
    const label =
      phase === "done"
        ? integrationCompletedActivityLabel(tool, query, codeHostProvider)
        : integrationRunningActivityLabel(tool, query, codeHostProvider);
    const event: IntegrationToolActivityEvent = {
      tool,
      phase,
      label,
      ...(query ? { query } : {}),
      ...(phase === "done" ? { detail: formatIntegrationHitDetail(extra?.hits ?? [], extra?.error) } : {})
    };
    options.onToolActivity?.(event);
  };
  const connected = options.integrations;
  const allow = (flag: boolean | undefined): boolean => flag !== false;
  /** Named/allowlisted tools always attempt fetch (surface not-connected errors). */
  const allowOrForced = (
    provider: IntegrationChatProvider,
    flag: boolean | undefined
  ): boolean => requestAllowsIntegrationFetch(options.request, provider) || allow(flag);

  const shouldFetchConfluence =
    deps.shouldFetchConfluenceContext(options.request) && allowOrForced("confluence", connected?.confluence);
  const shouldFetchNotion =
    deps.shouldFetchNotionContext(options.request) && allowOrForced("notion", connected?.notion);

  const runTool = async <T>(
    tool: IntegrationActivityTool,
    enabled: boolean,
    fetch: () => Promise<T>
  ): Promise<T | undefined> => {
    if (!enabled) {
      return undefined;
    }
    notify(tool, "start");
    let result: T | undefined;
    let error: string | undefined;
    try {
      result = await fetch();
      return result;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "Search failed";
      throw caught;
    } finally {
      notify(tool, "done", {
        hits: hitsFromSearchResult(tool, result),
        error
      });
    }
  };

  const [confluenceSearch, notionSearch] = await Promise.all([
    runTool("confluence", shouldFetchConfluence, () =>
      deps.fetchConfluenceSearchContext({
        secrets: options.secrets,
        owner: options.owner,
        repo: options.repo,
        extraTerms: integrationTerms,
        integrationScope: options.integrationScopes?.atlassian
      })
    ),
    runTool("notion", shouldFetchNotion, () =>
      deps.fetchNotionSearchContext({
        secrets: options.secrets,
        owner: options.owner,
        repo: options.repo,
        extraTerms: integrationTerms,
        integrationScope: options.integrationScopes?.notion
      })
    )
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

  const shouldFetchJira =
    deps.shouldFetchJiraContext(options.request) && allowOrForced("jira", connected?.jira);
  const shouldFetchGoogleDocs =
    deps.shouldFetchGoogleDocsContext(options.request) &&
    allowOrForced("google-docs", connected?.googleDocs);
  const [jiraSearch, googleDocsSearch] = await Promise.all([
    runTool("jira", shouldFetchJira, () =>
      deps.fetchJiraSearchContext({
        secrets: options.secrets,
        ...base,
        crossToolText: crossToolKeys,
        extraTerms: integrationTerms,
        codeHostRouter: options.codeHostRouter,
        codeHostConnected: options.codeHostConnected,
        integrationScope: options.integrationScopes?.atlassian
      })
    ),
    runTool("google-docs", shouldFetchGoogleDocs, () =>
      deps.fetchGoogleDocsSearchContext({
        secrets: options.secrets,
        ...base,
        crossToolText: crossToolKeys,
        extraTerms: docExtraTerms,
        integrationScope: options.integrationScopes?.["google-docs"]
      })
    )
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
  const shouldFetchSlack =
    deps.shouldFetchSlackContext(options.request) && allowOrForced("slack", connected?.slack);
  const shouldFetchTeams =
    deps.shouldFetchTeamsContext(options.request) && allowOrForced("teams", connected?.teams);
  const [slackSearch, teamsSearch] = await Promise.all([
    runTool("slack", shouldFetchSlack, () =>
      deps.fetchSlackSearchContext({
        secrets: options.secrets,
        ...base,
        crossToolText: crossToolKeys,
        jiraIssueKeys,
        integrationScope: options.integrationScopes?.slack
      })
    ),
    runTool("teams", shouldFetchTeams, () =>
      deps.fetchTeamsSearchContext({
        secrets: options.secrets,
        ...base,
        crossToolText: crossToolKeys,
        jiraIssueKeys
      })
    )
  ]);
  if (shouldFetchSlack) {
    data.slackSearch = slackSearch;
  }
  if (shouldFetchTeams) {
    data.teamsSearch = teamsSearch;
  }
  const shouldFetchCodeHost =
    deps.shouldFetchCodeHostContext(options.request) && Boolean(options.codeHostConnected);
  if (shouldFetchCodeHost) {
    data.codeHostSearch = await runTool("code-host", true, () =>
      deps.fetchCodeHostSearchContext({
        router: options.codeHostRouter,
        provider: options.codeHostProvider,
        ...base
      })
    );
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
  // Zero-Clone: seeds from timeline only — never hydrate from local disk.
  return buildTraceDecisionSearchSeeds(timeline, file, undefined);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? { ...(value as Record<string, unknown>) } : {};
}

function hitsFromSearchResult(tool: IntegrationActivityTool, result: unknown): string[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  const data = result as Record<string, unknown>;
  switch (tool) {
    case "confluence":
    case "notion":
      return titlesFrom(data.pages);
    case "google-docs":
      return titlesFrom(data.documents);
    case "jira":
      return jiraHitLines(data.issues);
    case "slack":
      return textHits(data.messages, "text");
    case "teams":
      return textHits(data.messages, "body");
    case "code-host":
      return [
        ...numberedHits(data.pullRequests, "PR"),
        ...numberedHits(data.issues, "#")
      ];
    default:
      return [];
  }
}

function titlesFrom(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "object" && entry && "title" in entry ? String(entry.title ?? "") : ""))
    .map((title) => title.trim())
    .filter(Boolean);
}

function jiraHitLines(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const row = entry as { key?: string; summary?: string };
      return [row.key, row.summary].filter(Boolean).join(" ").trim();
    })
    .filter(Boolean);
}

function textHits(value: unknown, field: "text" | "body"): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const row = entry as Record<string, unknown>;
      return String(row[field] ?? "").trim();
    })
    .filter(Boolean);
}

function numberedHits(value: unknown, prefix: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const row = entry as { number?: number; title?: string };
      const number = row.number !== undefined ? `${prefix === "PR" ? "PR #" : "#"}${row.number}` : prefix;
      return [number, row.title].filter(Boolean).join(" ").trim();
    })
    .filter(Boolean);
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
