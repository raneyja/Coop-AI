import type { QuickActionId } from "../webview/types";
import {
  enrichKnowledgeGapsResponse,
  extractConfluencePagesFromBundle
} from "../prompts/knowledgeGapsEnrichment";

/**
 * Post-processes assistant responses for quick actions and their slash-command aliases.
 * Add new enrichers here so grid buttons and /slash routes stay aligned.
 */
export function enrichChatResponseForAction(options: {
  quickAction: QuickActionId | undefined;
  content: string;
  contextBundle?: unknown;
  activeFile?: string;
}): string {
  const { quickAction, content, contextBundle, activeFile } = options;

  switch (quickAction) {
    case "knowledge-gaps": {
      const pages = extractConfluencePagesFromBundle(contextBundle);
      return enrichKnowledgeGapsResponse(content, { confluencePages: pages, activeFile });
    }
    default:
      return content;
  }
}
