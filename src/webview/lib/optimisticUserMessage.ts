import type { ChatFileMention, ChatImageAttachment } from "../../chat/types";
import { plainChatHistoryContent, type PlainChatHistoryContext } from "../../prompts/mentionScope";
import { quickActionHistoryContent } from "../../prompts/quickActionPrompts";
import { isQuickActionId } from "../types";

export type OptimisticUserMessage = {
  role: "user";
  content: string;
  timestamp: number;
  attachments?: ChatImageAttachment[];
};

export type OptimisticUserTurn = {
  message: OptimisticUserMessage;
  /** Message count before this send — stale history snapshots must not wipe the bubble. */
  baselineCount: number;
};

export function buildOptimisticUserMessage(input: {
  message: string;
  historyContent?: string;
  quickAction?: string;
  slashUserArgs?: string;
  attachments?: ChatImageAttachment[];
  mentions?: ChatFileMention[];
  context?: PlainChatHistoryContext;
  baselineCount: number;
  timestamp?: number;
}): OptimisticUserTurn {
  const mentionRefs = (input.mentions ?? []).slice(0, 3).map((mention) => ({
    path: mention.path,
    repoId: mention.repoId,
    source: mention.source
  }));
  const content =
    input.historyContent?.trim() ||
    (input.quickAction && isQuickActionId(input.quickAction)
      ? quickActionHistoryContent(
          input.quickAction,
          input.context ?? {},
          input.slashUserArgs,
          mentionRefs
        )
      : plainChatHistoryContent(input.message, mentionRefs, {
          context: input.context,
          includeContextChips: true
        }));
  return {
    baselineCount: input.baselineCount,
    message: {
      role: "user",
      content: content || input.attachments?.[0]?.name || "",
      timestamp: input.timestamp ?? Date.now(),
      attachments: input.attachments?.length ? input.attachments : undefined
    }
  };
}

/**
 * Keep a locally painted user bubble until host history includes that new turn.
 * Suggest-dismiss and other mid-send snapshots are shorter and must not hide it.
 */
export function mergeChatHistoryWithOptimistic<T extends { role: string }>(
  incoming: T[],
  optimistic: OptimisticUserTurn | null
): { messages: T[]; settled: boolean } {
  if (!optimistic) {
    return { messages: incoming, settled: true };
  }
  if (incoming.length === 0) {
    return { messages: incoming, settled: true };
  }
  const covered = incoming.slice(optimistic.baselineCount).some((entry) => entry.role === "user");
  if (covered) {
    return { messages: incoming, settled: true };
  }
  return {
    messages: [...incoming, optimistic.message as unknown as T],
    settled: false
  };
}
