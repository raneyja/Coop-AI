import type { QuickActionId } from "../webview/types";
import type { IntegrationChatProvider } from "../chat/types";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  enrichKnowledgeGapsResponse,
  extractConfluencePagesFromBundle
} from "../prompts/knowledgeGapsEnrichment";
import {
  enrichOutOfScopeMentionsInResponse,
  resolveOutOfScopeMentionLabels
} from "../prompts/mentionResponseEnrichment";
import {
  enrichTraceDecisionResponse
} from "../prompts/decisionResponseEnrichment";
import {
  mentionsHaveOutOfScopeForActiveRepo,
  type MentionScopeQuickAction,
  type MentionScopeRef
} from "../prompts/mentionScope";

/**
 * Post-processes assistant responses for quick actions and their slash-command aliases.
 * Add new enrichers here so grid buttons and /slash routes stay aligned.
 */
export function enrichChatResponseForAction(options: {
  quickAction?: QuickActionId;
  integrationProvider?: IntegrationChatProvider;
  content: string;
  contextBundle?: unknown;
  activeFile?: string;
  mentions?: MentionScopeRef[];
  activeRepoId?: string;
  owner?: string;
  repo?: string;
  userQuestion?: string;
  fallbackTimeline?: DecisionTimeline;
  isTraceFollowUp?: boolean;
}): string {
  const { quickAction, integrationProvider, content, contextBundle, activeFile } = options;
  const mentions = options.mentions ?? [];
  const scopeAction: MentionScopeQuickAction | undefined =
    quickAction ??
    (integrationProvider
      ? "integration"
      : mentionsHaveOutOfScopeForActiveRepo(mentions, options.activeRepoId)
        ? "integration"
        : undefined);

  let enriched = enrichPlainChatMentionResponse(content, {
    mentions,
    activeRepoId: options.activeRepoId,
    scopeAction
  });

  const outOfScopePaths = resolveOutOfScopeMentionLabels(scopeAction, mentions, {
    activeRepoId: options.activeRepoId,
    owner: options.owner,
    repo: options.repo,
    contextBundle
  });
  if (outOfScopePaths.length) {
    const targetLabel =
      options.owner && options.repo ? `${options.owner}/${options.repo}` : options.activeFile ?? "this scope";
    enriched = enrichOutOfScopeMentionsInResponse(enriched, {
      action: scopeAction,
      outOfScopePaths,
      targetLabel
    });
  }

  switch (quickAction) {
    case "trace-decision":
      return enrichTraceDecisionResponse({
        content: enriched,
        userQuestion: options.userQuestion,
        contextBundle,
        activeFile,
        fallbackTimeline: options.fallbackTimeline,
        isFollowUp: options.isTraceFollowUp
      });
    case "knowledge-gaps": {
      const pages = extractConfluencePagesFromBundle(contextBundle);
      return enrichKnowledgeGapsResponse(enriched, { confluencePages: pages, activeFile });
    }
    default:
      return enriched;
  }
}

/** Plain-chat post-processing hook — out-of-scope @ attachments handled above. */
function enrichPlainChatMentionResponse(
  content: string,
  _options: {
    mentions: MentionScopeRef[];
    activeRepoId?: string;
    scopeAction?: MentionScopeQuickAction;
  }
): string {
  return content;
}
