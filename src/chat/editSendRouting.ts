import { plainChatHistoryContent, type MentionScopeRef } from "../prompts/mentionScope";

export type EditSendOptions = {
  composerMode?: string;
  historyContent?: string;
  mentions?: unknown[];
};

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
