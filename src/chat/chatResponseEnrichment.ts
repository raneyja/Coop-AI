import type { QuickActionId } from "../webview/types";
import type { IntegrationChatProvider } from "../chat/types";
import type { DecisionTimeline } from "../types/decisionTimeline";
import {
  enrichIntegrationDocsResponse,
  enrichKnowledgeGapsResponse,
  extractConfluencePagesFromBundle,
  extractGoogleDocsFromBundle,
  extractJobScanGapsFromBundle,
  extractNotionPagesFromBundle
} from "../prompts/knowledgeGapsEnrichment";
import { enrichSourcesFooter, hasSourcesFooterSection } from "../prompts/sourcesFooterEnrichment";
import {
  enrichOutOfScopeMentionsInResponse,
  resolveOutOfScopeMentionLabels
} from "../prompts/mentionResponseEnrichment";
import {
  enrichTraceDecisionResponse
} from "../prompts/decisionResponseEnrichment";
import { enrichFindOwnerResponse } from "../prompts/ownershipResponseEnrichment";
import { stripDisallowedNarrativeSourceCitations } from "../prompts/evidenceSynthesis";
import { enrichCompactIntegrationDocs } from "../prompts/integrationDocsCompactEnrichment";
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

  enriched = stripDisallowedNarrativeSourceCitations(enriched);

  switch (quickAction) {
    case "trace-decision":
      enriched = enrichTraceDecisionResponse({
        content: enriched,
        userQuestion: options.userQuestion,
        contextBundle,
        activeFile,
        fallbackTimeline: options.fallbackTimeline,
        isFollowUp: options.isTraceFollowUp
      });
      break;
    case "find-owner":
      enriched = enrichFindOwnerResponse(enriched);
      break;
    case "knowledge-gaps": {
      enriched = enrichKnowledgeGapsResponse(enriched, {
        confluencePages: extractConfluencePagesFromBundle(contextBundle),
        notionPages: extractNotionPagesFromBundle(contextBundle),
        googleDocs: extractGoogleDocsFromBundle(contextBundle),
        jobScanGaps: extractJobScanGapsFromBundle(contextBundle),
        activeFile
      });
      break;
    }
    case "understand-repo":
    case "blast-radius": {
      const docContext = {
        confluencePages: extractConfluencePagesFromBundle(contextBundle),
        notionPages: extractNotionPagesFromBundle(contextBundle),
        googleDocs: extractGoogleDocsFromBundle(contextBundle),
        activeFile
      };
      enriched = enrichIntegrationDocsResponse(enriched, docContext);
      enriched = enrichCompactIntegrationDocs(enriched, docContext, {
        mode: quickAction === "understand-repo" ? "understand-repo" : "blast-radius"
      });
      break;
    }
    default:
      break;
  }

  if (shouldEnrichSourcesFooter(options.quickAction, options.integrationProvider, enriched)) {
    enriched = enrichSourcesFooter(enriched);
  }

  return enriched;
}

function shouldEnrichSourcesFooter(
  quickAction: QuickActionId | undefined,
  integrationProvider: IntegrationChatProvider | undefined,
  content: string
): boolean {
  if (!quickAction && !integrationProvider) {
    return false;
  }
  return hasSourcesFooterSection(content);
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
