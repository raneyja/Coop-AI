import type { ChatFileMention, ChatImageAttachment } from "../../chat/types";

/** Cap matches Cursor's "a few follow-ups," not an unbounded stack. */
export const MAX_QUEUED_FOLLOW_UPS = 3;

export type QueuedFollowUp = {
  id: string;
  text: string;
  attachments: ChatImageAttachment[];
  mentions: ChatFileMention[];
  pendingPromptActionId?: string;
};

export type FollowUpSubmitAction = "send" | "queue" | "stop-and-send" | "ignore";

export type StreamEndReason = "complete" | "error" | "cancelled" | "quota" | "thread-changed";

let followUpSeq = 0;

export function createFollowUpId(): string {
  followUpSeq += 1;
  return `follow-up-${followUpSeq}`;
}

export function previewQueuedFollowUp(item: QueuedFollowUp): string {
  const line = item.text.trim().split("\n")[0] ?? "";
  if (line) {
    return line.length > 80 ? `${line.slice(0, 79)}…` : line;
  }
  if (item.attachments.length > 0) {
    return item.attachments[0]?.name ?? "Attachment";
  }
  if (item.mentions.length > 0) {
    return item.mentions[0]?.path ?? "Mention";
  }
  return "Follow-up";
}

export function enqueueFollowUp(
  queue: QueuedFollowUp[],
  item: Omit<QueuedFollowUp, "id"> & { id?: string },
  options?: { front?: boolean }
): { queue: QueuedFollowUp[]; enqueued: boolean } {
  if (queue.length >= MAX_QUEUED_FOLLOW_UPS) {
    return { queue, enqueued: false };
  }
  const next: QueuedFollowUp = {
    id: item.id ?? createFollowUpId(),
    text: item.text,
    attachments: item.attachments,
    mentions: item.mentions,
    pendingPromptActionId: item.pendingPromptActionId
  };
  return {
    queue: options?.front ? [next, ...queue] : [...queue, next],
    enqueued: true
  };
}

export function removeFollowUp(queue: QueuedFollowUp[], id: string): QueuedFollowUp[] {
  return queue.filter((item) => item.id !== id);
}

export function dequeueFollowUp(queue: QueuedFollowUp[]): {
  next: QueuedFollowUp | undefined;
  rest: QueuedFollowUp[];
} {
  const [next, ...rest] = queue;
  return { next, rest };
}

/**
 * Enter queues while Coop is answering. Cmd/Ctrl+Enter stops the current
 * answer and sends immediately (Cursor's interrupt path).
 */
export function resolveFollowUpSubmitAction(input: {
  isStreaming: boolean;
  canSend: boolean;
  modifierSend: boolean;
}): FollowUpSubmitAction {
  if (!input.canSend) {
    return "ignore";
  }
  if (!input.isStreaming) {
    return "send";
  }
  return input.modifierSend ? "stop-and-send" : "queue";
}

/** Auto-send the queue only when the current answer finished on its own. */
export function shouldAutoFlushFollowUpQueue(input: {
  reason: StreamEndReason;
  queueLength: number;
}): boolean {
  if (input.queueLength <= 0) {
    return false;
  }
  return input.reason === "complete" || input.reason === "error";
}
