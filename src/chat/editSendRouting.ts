import { plainChatHistoryContent, type MentionScopeRef } from "../prompts/mentionScope";

export type EditSendOptions = {
  composerMode?: string;
  historyContent?: string;
  mentions?: unknown[];
  integrationProvider?: string;
  sourceHint?: string;
};

/**
 * True when handleChatSend should parse leading `/edit` (etc.) again.
 * Already-routed composer/integration sends keep `/edit …` in the message
 * body — re-parsing those would recurse until the stack overflows.
 */
export function shouldParseSlashCommandOnSend(
  quickAction: string | undefined,
  options: EditSendOptions | undefined
): boolean {
  if (quickAction) {
    return false;
  }
  if (options?.sourceHint) {
    return false;
  }
  if (options?.composerMode !== undefined) {
    return false;
  }
  if (options?.integrationProvider !== undefined) {
    return false;
  }
  return true;
}

/** True when an edit-mode send should record edit.requested and patch retry context. */
export function shouldTrackEditRequest(
  options: EditSendOptions | undefined,
  quickAction: string | undefined
): boolean {
  return options?.composerMode === "edit" && !quickAction;
}

/** Bubble/history text stored for patch retry — mirrors handleChatSend edit path. */
export function resolveEditTrackingMessage(
  message: string,
  options: EditSendOptions | undefined,
  mentionRefs: MentionScopeRef[] = []
): string {
  return options?.historyContent ?? plainChatHistoryContent(message, mentionRefs);
}
