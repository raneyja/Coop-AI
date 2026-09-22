/**
 * Activity labels may name work that is committed for this turn, in flight, or finished.
 * They must use the same gates as fetch / agent routing. A planned tool is not a label.
 */
import type { ChatIntentPlan } from "../chat/intentPlanner/types";
import { locateJobTerms } from "../chat/intentPlanner/planChatJobs";
import { agentTurnAction, shouldSkipAgentHuntForOpenFileFeatureAdd } from "../chat/agentRouting";
import { openFileSelectionOwnsChange } from "../chat/openFileSelectionChange";
import type { RepoCodeAction } from "../chat/repoCodeIntent";
import { isOpenFileReviewAsk } from "../chat/plainChatExplain";
import { isFileCallerQuery } from "./fileCallerIntent";
import { isFileHistoryQuery } from "./fileHistoryIntent";
import { hasRepoFactNeed, repoFactNeeds } from "../workspace/repoFactIntent";
import { repoFactActivityLabel } from "../chat/chatTurnActivity";
import {
  isPlainChatIntentEvent,
  shouldRunRepoSemanticRetrieval
} from "./repoSemanticRetrieval";
import { isFileAssistantSession, type SessionMode } from "./sessionMode";
import type { IntentEvent } from "./intentDetector";

const REPO_WORKFLOWS = new Set([
  "understand-repo",
  "knowledge-gaps",
  "trace-decision",
  "find-owner",
  "blast-radius"
]);

/** True when the agent loop owns the turn and indexed gather is skipped. */
export function agentOwnsIndexedGather(input: {
  fileAssistant: boolean;
  hasQuickAction: boolean;
  isEditTurn: boolean;
  agentAction: RepoCodeAction;
  skipOpenFileFeatureAdd: boolean;
  honestRepoScope: boolean;
  repoId?: string;
}): boolean {
  if (input.fileAssistant || input.hasQuickAction || input.isEditTurn) {
    return false;
  }
  if (input.agentAction === "none" || input.skipOpenFileFeatureAdd) {
    return false;
  }
  if (!input.honestRepoScope) {
    return false;
  }
  const repoId = input.repoId?.trim() ?? "";
  return Boolean(repoId) && !repoId.includes("unknown/unknown");
}

/**
 * fetchContextRequest calls enrichChatContextWithSemanticSearch only in this case.
 * The call can still no-op inside searchRepoForChat — use {@link willRunIndexedCodeSearch}
 * before showing a search label.
 */
export function willEnrichChatWithSemanticSearch(input: {
  fileAssistant: boolean;
  requestType: string;
  dualRepoCompare: boolean;
  repoFact: boolean;
}): boolean {
  if (input.fileAssistant || input.dualRepoCompare || input.repoFact) {
    return false;
  }
  return input.requestType === "chat_context";
}

/** True when a repo index search will actually start (including open-file paths-only). */
export function willRunIndexedCodeSearch(input: {
  fileAssistant: boolean;
  requestType: string;
  dualRepoCompare: boolean;
  repoFact: boolean;
  queryText?: string;
  selectionText?: string;
  quickAction?: string;
  intentIsPlainChat: boolean;
  codeEditIntent?: boolean;
  inScopeMentionCount?: number;
  integrationProvider?: string;
  hasRepoId: boolean;
  locateTerms?: string[];
  enabled?: boolean;
  agentOwnsTurn?: boolean;
}): boolean {
  if (input.agentOwnsTurn || !input.hasRepoId) {
    return false;
  }
  if (!willEnrichChatWithSemanticSearch(input)) {
    return false;
  }
  if ((input.locateTerms?.length ?? 0) > 0) {
    return true;
  }
  return shouldRunRepoSemanticRetrieval({
    queryText: input.queryText,
    selectionText: input.selectionText,
    quickAction: input.quickAction,
    intentIsPlainChat: input.intentIsPlainChat,
    codeEditIntent: input.codeEditIntent,
    inScopeMentionCount: input.inScopeMentionCount,
    enabled: input.enabled,
    integrationProvider: input.integrationProvider
  });
}

export function willRunDurableDependents(input: {
  fileAssistant: boolean;
  agentOwnsTurn: boolean;
  quickAction?: string;
  queryText?: string;
  hasFile: boolean;
  hasRepoId: boolean;
}): boolean {
  if (input.fileAssistant || input.agentOwnsTurn || input.quickAction) {
    return false;
  }
  if (!input.hasFile || !input.hasRepoId) {
    return false;
  }
  return isFileCallerQuery(input.queryText) || isOpenFileReviewAsk(input.queryText);
}

export function willRunFileHistory(input: {
  fileAssistant: boolean;
  agentOwnsTurn: boolean;
  quickAction?: string;
  queryText?: string;
  hasFile: boolean;
  hasCodeHostCoords: boolean;
}): boolean {
  if (input.fileAssistant || input.agentOwnsTurn || input.quickAction) {
    return false;
  }
  if (!input.hasFile || !input.hasCodeHostCoords) {
    return false;
  }
  return isFileHistoryQuery(input.queryText);
}

export function willRunRepoInventory(input: {
  fileAssistant: boolean;
  agentOwnsTurn: boolean;
  dualRepoCompare: boolean;
  requestType: string;
  queryText?: string;
  honestRepoScope: boolean;
  hasRepoId: boolean;
}): boolean {
  if (
    input.fileAssistant ||
    input.agentOwnsTurn ||
    input.dualRepoCompare ||
    input.requestType !== "chat_context"
  ) {
    return false;
  }
  if (!input.honestRepoScope || !input.hasRepoId) {
    return false;
  }
  return hasRepoFactNeed(repoFactNeeds(input.queryText));
}

export function readActivityLabel(path: string): string {
  return `Read \`${path.trim()}\``;
}

/** Live and seed line for a repo search that is about to start. */
export function searchingRepoActivityLabel(terms: string[]): string | undefined {
  const preview = terms
    .map((term) => term.trim().replace(/`/g, "'").replace(/\s+/g, " "))
    .filter(Boolean)
    .slice(0, 3)
    .map((term) => (term.length > 72 ? `${term.slice(0, 71)}…` : term));
  if (!preview.length) {
    return undefined;
  }
  return `Searching repo for ${preview.map((term) => `\`${term}\``).join(", ")}`;
}

export type CommittedActivityOptions = {
  sessionMode?: SessionMode;
  /** Bodies already attached this turn (open buffer or remote tab). */
  attachedFilePaths?: string[];
  codeEditIntent?: boolean;
  selectionText?: string;
  dualRepoCompare?: boolean;
  semanticRetrievalEnabled?: boolean;
  inScopeMentionCount?: number;
  intentPlan?: ChatIntentPlan;
  /** From the session. Event context has no Use-repo scope flag. */
  honestRepoScope?: boolean;
  /** buildRepoId for this turn. Falls back to the event's repo id. */
  repoId?: string;
  /** Open-file feature-add asks skip the agent hunt. */
  skipOpenFileFeatureAdd?: boolean;
};

function sessionModeForEvent(event: IntentEvent, options: CommittedActivityOptions): SessionMode {
  if (options.sessionMode) {
    return options.sessionMode;
  }
  return isFileAssistantSession({
    file: event.context.file,
    fileSource: event.context.fileSource
  })
    ? "file-assistant"
    : "indexed-repo";
}

function explicitWorkflowSeeds(action: string): string[] {
  switch (action) {
    case "understand-repo":
      return ["Building repository overview…"];
    case "knowledge-gaps":
      return ["Scanning for knowledge gaps…"];
    case "trace-decision":
      return ["Tracing decision evidence…"];
    case "find-owner":
      return ["Finding code owners…"];
    case "blast-radius":
      return ["Analyzing dependencies…", "Scanning callers and dependents…"];
    default:
      return [];
  }
}

/**
 * Seed labels for work already committed on this turn.
 * Integration fetches stay live-only (label when the fetch starts).
 */
export function committedActivitySeeds(
  event: IntentEvent,
  options: CommittedActivityOptions = {}
): string[] {
  const mode = sessionModeForEvent(event, options);
  const fileAssistant = mode === "file-assistant";
  const action = event.context.buttonClicked?.trim();
  const messages: string[] = [];

  for (const path of options.attachedFilePaths ?? []) {
    const trimmed = path.trim();
    if (trimmed) {
      messages.push(readActivityLabel(trimmed));
    }
  }

  if (action && REPO_WORKFLOWS.has(action)) {
    if (fileAssistant) {
      return messages;
    }
    messages.push(...explicitWorkflowSeeds(action));
    return messages;
  }

  const queryText = event.context.queryText;
  const file = event.context.file?.trim();
  const repoId =
    options.repoId?.trim() ||
    event.context.repoId?.trim() ||
    (event.context.owner?.trim() && event.context.repo?.trim()
      ? `${event.context.owner.trim()}/${event.context.repo.trim()}`
      : "");
  const hasRepoId = Boolean(repoId) && !repoId.includes("unknown/unknown");
  const hasCodeHostCoords = Boolean(event.context.owner?.trim() && event.context.repo?.trim());
  const honestRepoScope =
    options.honestRepoScope ??
    Boolean((file && hasCodeHostCoords) || (hasCodeHostCoords && event.context.repoId));
  const locateTerms = locateJobTerms(options.intentPlan?.jobs);
  const selectedLines = event.context.lines
    ? ([event.context.lines.start, event.context.lines.end] as [number, number])
    : undefined;
  const selectionOwnsChange = openFileSelectionOwnsChange({
    file,
    selectedLines,
    message: queryText ?? "",
    fileAssistant,
    explicitEdit: Boolean(options.codeEditIntent),
    hasQuickAction: Boolean(action),
    integrationSlash: Boolean(event.context.integrationProvider)
  });
  const agentAction = agentTurnAction({
    query: queryText ?? "",
    hasQuickAction: Boolean(action),
    intentPlan: options.intentPlan,
    isEditTurn: options.codeEditIntent,
    integrationSlash: Boolean(event.context.integrationProvider),
    fileAssistant,
    file,
    selectedLines
  });
  const agentOwnsTurn = agentOwnsIndexedGather({
    fileAssistant,
    hasQuickAction: Boolean(action),
    isEditTurn: Boolean(options.codeEditIntent),
    agentAction,
    skipOpenFileFeatureAdd:
      options.skipOpenFileFeatureAdd ??
      shouldSkipAgentHuntForOpenFileFeatureAdd({
        message: queryText ?? "",
        openFile: file
      }),
    honestRepoScope,
    repoId
  });
  const repoFact = hasRepoFactNeed(repoFactNeeds(queryText));
  const requestType = "chat_context";
  const searchInput = {
    fileAssistant,
    requestType,
    dualRepoCompare: Boolean(options.dualRepoCompare),
    repoFact,
    queryText,
    selectionText: options.selectionText,
    quickAction: action,
    intentIsPlainChat: isPlainChatIntentEvent(event),
    codeEditIntent: options.codeEditIntent,
    inScopeMentionCount: options.inScopeMentionCount,
    integrationProvider: event.context.integrationProvider,
    hasRepoId,
    locateTerms,
    enabled: options.semanticRetrievalEnabled,
    agentOwnsTurn
  };

  if (willRunRepoInventory({
    fileAssistant,
    agentOwnsTurn,
    dualRepoCompare: Boolean(options.dualRepoCompare),
    requestType,
    queryText,
    honestRepoScope,
    hasRepoId
  })) {
    const fact = repoFactActivityLabel(queryText);
    if (fact) {
      messages.push(fact);
    }
  } else if (!selectionOwnsChange && willRunIndexedCodeSearch(searchInput)) {
    const label =
      locateTerms.length > 0
        ? searchingRepoActivityLabel(locateTerms)
        : searchingRepoActivityLabel(queryText ? [queryText] : []);
    if (label) {
      messages.push(label);
    }
  }

  if (
    willRunDurableDependents({
      fileAssistant,
      agentOwnsTurn,
      quickAction: action,
      queryText,
      hasFile: Boolean(file),
      hasRepoId
    })
  ) {
    messages.push(file ? `Find files that rely on \`${file}\`` : "Find files that rely on it");
  }
  if (
    willRunFileHistory({
      fileAssistant,
      agentOwnsTurn,
      quickAction: action,
      queryText,
      hasFile: Boolean(file),
      hasCodeHostCoords
    })
  ) {
    messages.push(file ? `Look up who created \`${file}\`` : "Look up who created it");
  }

  return messages;
}
