import type { ChatMessage } from "./types";
import { parseSlashCommand } from "../context/slashCommands";
import type { QuickActionId } from "../webview/types";

const QUICK_ACTION_TAG_RE = /^\[([\w-]+)\]/;

/**
 * Resolves the quick action driving the current chat turn.
 * Slash commands (/gaps, /blast, …) and grid buttons ([knowledge-gaps], …)
 * must stay in sync — enrichment and use-case routing use this helper.
 */
export function resolveEffectiveQuickAction(
  quickAction: string | undefined,
  chatHistory: ChatMessage[]
): QuickActionId | undefined {
  if (quickAction) {
    return quickAction as QuickActionId;
  }

  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const message = chatHistory[i];
    if (message.role !== "user") {
      continue;
    }

    const tagMatch = message.content.match(QUICK_ACTION_TAG_RE);
    if (tagMatch?.[1]) {
      return tagMatch[1] as QuickActionId;
    }

    const parsed = parseSlashCommand(message.content.trim());
    if (parsed?.def.target.kind === "action") {
      return parsed.def.target.actionId;
    }
  }

  return undefined;
}
