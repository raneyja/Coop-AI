import type { ChatMessage } from "./types";
import type { QuickActionId } from "../webview/types";

/**
 * Quick action for **this** send only.
 * History `[blast-radius]` tags and prior `/blast` lines must not stick onto a
 * later plain follow-up. The next `/blast` (or grid / prompt-library actionId)
 * is required to re-enter.
 */
export function resolveEffectiveQuickAction(
  quickAction: string | undefined,
  _chatHistory: ChatMessage[]
): QuickActionId | undefined {
  if (quickAction) {
    return quickAction as QuickActionId;
  }
  return undefined;
}
