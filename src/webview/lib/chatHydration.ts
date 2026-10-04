import type { ChatHistoryPayload, ChatMessage } from "../../chat/types";

/** Only explicit thread changes reset a draft; snapshots only hydrate history. */
export function shouldAcceptHistory(
  payload: ChatHistoryPayload | ChatMessage[],
  activeThreadId: string | undefined,
  lastRevision: number
): boolean {
  if (Array.isArray(payload)) {
    return true;
  }
  return (!payload.threadId || !activeThreadId || payload.threadId === activeThreadId) &&
    (payload.revision === undefined || payload.revision > lastRevision);
}

export function historyAcknowledgesPendingUser(messages: ChatMessage[], clientSubmissionId: string): boolean {
  return messages.some((entry) => entry.role === "user" && entry.clientSubmissionId === clientSubmissionId);
}

/** Account hydration changes thread identity without discarding an unsent draft. */
export function shouldResetComposerDraft(preserveDraft: boolean | undefined): boolean {
  return preserveDraft !== true;
}

/** Keep the panel serializer identity when saving composer state. */
export function persistedChatPanelState(draftInput: string, sessionId?: string): {draftInput: string; sessionId?: string} {
  return { draftInput, ...(sessionId ? {sessionId} : {}) };
}
