import { appendThinkingProcessingTerms } from "./thinkingProcessingTerms";
import { shouldFetchCodeHostContext } from "./codeHostContext";
import { shouldFetchConfluenceContext } from "./confluenceContext";
import { shouldFetchGoogleDocsContext } from "./googleDocsContext";
import {
  ContextRequestType,
  IntentEvent,
  requestTypesForIntent,
  UserIntent
} from "./intentDetector";
import { shouldFetchJiraContext } from "./jiraContext";
import { shouldFetchNotionContext } from "./notionContext";
import { buildContextRequests, ContextFetchRequest } from "./requestBatcher";
import { shouldFetchSlackContext } from "./slackContext";
import { shouldFetchTeamsContext } from "./teamsContext";
import type { CodeHostProviderPreference } from "../chat/types";
import { gateOptionsFromRequest, shouldRunRepoSemanticRetrieval } from "./repoSemanticRetrieval";

export const CONTEXT_GATHERING_STEP_MS = 850;

export type ContextGatheringIntegrationConnections = {
  jira?: boolean;
  slack?: boolean;
  teams?: boolean;
  confluence?: boolean;
  notion?: boolean;
  googleDocs?: boolean;
};

export type ContextGatheringMessageOptions = {
  codeHostProvider?: CodeHostProviderPreference;
  /** When false, skip code-host estate / PR search lines. Defaults to true. */
  codeHostConnected?: boolean;
  integrations?: ContextGatheringIntegrationConnections;
};

const REQUEST_TYPE_MESSAGES: Record<ContextRequestType, string> = {
  file_metadata: "Reading repository file metadata…",
  ownership: "Finding code owners…",
  blame: "Tracing recent changes…",
  dependencies: "Mapping dependencies and impact…",
  decision_history: "Reviewing decision history…",
  knowledge_gaps: "Scanning for knowledge gaps…",
  chat_context: "Gathering workspace context…"
};

const REPO_WIDE_ACTIONS = new Set(["understand-repo", "knowledge-gaps"]);

function uniqueMessages(messages: string[]): string[] {
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message)) {
      return false;
    }
    seen.add(message);
    return true;
  });
}

function finalizeActivityMessages(event: IntentEvent, messages: string[]): string[] {
  const unique = uniqueMessages(messages);
  if (!unique.length) {
    return unique;
  }
  return appendThinkingProcessingTerms(unique, `${event.id}:${event.timestamp.getTime()}`);
}

function codeHostEstateMessage(provider: CodeHostProviderPreference): string {
  switch (provider) {
    case "gitlab":
      return "Searching GitLab estate index…";
    case "bitbucket":
      return "Searching Bitbucket estate index…";
    default:
      return "Searching GitHub estate index…";
  }
}

function codeHostPullRequestMessage(provider: CodeHostProviderPreference): string {
  switch (provider) {
    case "gitlab":
      return "Searching GitLab merge request history…";
    case "bitbucket":
      return "Searching Bitbucket pull request history…";
    default:
      return "Searching GitHub pull request history…";
  }
}

function traceDecisionMessages(provider: CodeHostProviderPreference, codeHostConnected: boolean): string[] {
  const messages: string[] = [];
  if (codeHostConnected) {
    messages.push(codeHostPullRequestMessage(provider));
  }
  messages.push("Reviewing commit and PR history…", "Tracing decision evidence…");
  return messages;
}

function blastRadiusMessages(provider: CodeHostProviderPreference, codeHostConnected: boolean): string[] {
  void provider;
  void codeHostConnected;
  return ["Analyzing dependencies…", "Mapping change impact…", "Building context before sending your prompt…"];
}

function integrationMessagesForRequests(
  requests: ContextFetchRequest[],
  options: Required<Pick<ContextGatheringMessageOptions, "codeHostProvider" | "codeHostConnected">> &
    Pick<ContextGatheringMessageOptions, "integrations">
): string[] {
  const messages: string[] = [];
  const { codeHostProvider, codeHostConnected, integrations = {} } = options;
  const quickAction = requests[0]?.params.quickAction;

  if (codeHostConnected && quickAction && REPO_WIDE_ACTIONS.has(quickAction)) {
    messages.push(codeHostEstateMessage(codeHostProvider));
  }

  for (const request of requests) {
    if (integrations.jira && shouldFetchJiraContext(request)) {
      messages.push("Reviewing Jira tickets…");
    }
    if (integrations.slack && shouldFetchSlackContext(request)) {
      messages.push("Pulling in Slack messages…");
    }
    if (integrations.teams && shouldFetchTeamsContext(request)) {
      messages.push("Searching Teams conversations…");
    }
    if (integrations.confluence && shouldFetchConfluenceContext(request)) {
      messages.push("Searching Confluence pages…");
    }
    if (integrations.notion && shouldFetchNotionContext(request)) {
      messages.push("Searching Notion pages…");
    }
    if (integrations.googleDocs && shouldFetchGoogleDocsContext(request)) {
      messages.push("Searching Google Docs…");
    }
    if (codeHostConnected && shouldFetchCodeHostContext(request)) {
      messages.push(codeHostEstateMessage(codeHostProvider));
    }
  }
  return messages;
}

function requestTypeMessages(types: ContextRequestType[]): string[] {
  return types.map((type) => REQUEST_TYPE_MESSAGES[type]);
}

function fallbackMessages(event: IntentEvent): string[] {
  if (event.costEstimate === "expensive") {
    return ["Gathering deeper repo context…"];
  }
  return ["Updating lightweight context…"];
}

function resolvedOptions(
  options: ContextGatheringMessageOptions = {}
): Required<Pick<ContextGatheringMessageOptions, "codeHostProvider" | "codeHostConnected">> &
  Pick<ContextGatheringMessageOptions, "integrations"> {
  return {
    codeHostProvider: options.codeHostProvider ?? "github",
    codeHostConnected: options.codeHostConnected ?? true,
    integrations: options.integrations
  };
}

function repoWideActionMessages(
  event: IntentEvent,
  options: ContextGatheringMessageOptions
): string[] {
  const resolved = resolvedOptions(options);
  const types = requestTypesForIntent(event);
  const requests = buildContextRequests(event, types);
  const messages: string[] = [];

  if (resolved.codeHostConnected) {
    messages.push(codeHostEstateMessage(resolved.codeHostProvider));
  }

  messages.push(...requestTypeMessages(types));
  messages.push(...integrationMessagesForRequests(requests, resolved));

  return finalizeActivityMessages(event, messages);
}

function findOwnerMessages(
  event: IntentEvent,
  options: ContextGatheringMessageOptions
): string[] {
  const resolved = resolvedOptions(options);
  const requests = buildContextRequests(event, requestTypesForIntent(event));
  return finalizeActivityMessages(event, [
    "Finding code owners…",
    "Checking ownership signals…",
    ...integrationMessagesForRequests(requests, resolved)
  ]);
}

export function isPlainChatIntent(event: IntentEvent): boolean {
  return (
    !event.context.buttonClicked &&
    (event.intent === UserIntent.MANUAL_CHAT_SUBMIT || event.intent === UserIntent.HOTKEY_TRIGGERED)
  );
}

function hasRepoTarget(event: IntentEvent): boolean {
  return Boolean(
    event.context.owner?.trim() || event.context.repo?.trim() || event.context.repoId?.trim()
  );
}

function manualChatMessages(event: IntentEvent, options: ContextGatheringMessageOptions): string[] {
  const resolved = resolvedOptions(options);
  const requests = buildContextRequests(event, requestTypesForIntent(event));
  const messages: string[] = [];

  if (resolved.codeHostConnected && hasRepoTarget(event)) {
    messages.push(codeHostEstateMessage(resolved.codeHostProvider));
  }

  messages.push(REQUEST_TYPE_MESSAGES.chat_context);
  const chatRequest = requests.find((request) => request.type === "chat_context");
  if (
    chatRequest &&
    shouldRunRepoSemanticRetrieval(gateOptionsFromRequest(chatRequest, { enabled: true }))
  ) {
    messages.push("Searching indexed codebase…");
  }
  messages.push(...integrationMessagesForRequests(requests, resolved));
  messages.push("Preparing your answer…");

  return finalizeActivityMessages(event, messages);
}

/** Human-readable loading lines shown while context is fetched for an intent. */
export function contextGatheringMessagesFor(
  event: IntentEvent,
  options: ContextGatheringMessageOptions = {}
): string[] {
  const resolved = resolvedOptions(options);
  const action = event.context.buttonClicked;

  if (isPlainChatIntent(event)) {
    return manualChatMessages(event, options);
  }

  if (action && REPO_WIDE_ACTIONS.has(action)) {
    return repoWideActionMessages(event, options);
  }

  if (action === "trace-decision") {
    const requests = buildContextRequests(event, requestTypesForIntent(event));
    return finalizeActivityMessages(event, [
      ...traceDecisionMessages(resolved.codeHostProvider, resolved.codeHostConnected),
      ...integrationMessagesForRequests(requests, resolved)
    ]);
  }

  if (action === "find-owner") {
    return findOwnerMessages(event, options);
  }

  if (action === "blast-radius") {
    const requests = buildContextRequests(event, requestTypesForIntent(event));
    return finalizeActivityMessages(event, [
      ...blastRadiusMessages(resolved.codeHostProvider, resolved.codeHostConnected),
      ...integrationMessagesForRequests(requests, resolved)
    ]);
  }

  const types = requestTypesForIntent(event);
  if (types.length === 0) {
    return finalizeActivityMessages(event, fallbackMessages(event));
  }

  const requests = buildContextRequests(event, types);
  const messages = uniqueMessages([
    ...requestTypeMessages(types),
    ...integrationMessagesForRequests(requests, resolved)
  ]);

  if (messages.length === 0) {
    return finalizeActivityMessages(event, fallbackMessages(event));
  }

  const isExpensiveChat =
    event.costEstimate === "expensive" &&
    (event.intent === UserIntent.MANUAL_CHAT_SUBMIT || event.intent === UserIntent.HOTKEY_TRIGGERED);

  if (isExpensiveChat && !messages.some((message) => message.startsWith("Gathering"))) {
    messages.unshift("Gathering deeper repo context…");
  }

  return finalizeActivityMessages(event, messages);
}
