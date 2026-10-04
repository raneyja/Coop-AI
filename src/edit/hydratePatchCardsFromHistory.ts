import type { ChatMessage, PatchCardState, PatchCardsUpdatePayload } from "../chat/types";
import { buildPatchCardState, withSuppressionRegistry } from "./patchDiffPreview";
import { lookupPatchFileContent, sanitizedPatchTargetBindings } from "./patchFileContents";
import { parsePatchResponse } from "./patchParser";
import {
  getPatchRecord,
  getSuppressedMessageTimestamps,
  listPatchCards,
  markMessageMarkdownSuppressed,
  upsertPatchRecord
} from "./patchSession";
import { collectOpenPatchFileBytes } from "./patchTarget";
import { COMMENT_ONLY_REWRITE_REJECTED_ERROR, snapPatchSetToSelection } from "./snapPatchToSelection";

export type HistoryPatchMessage = {
  role: string;
  content: string;
  timestamp: number;
  patchCard?: PatchCardState;
};

function messageLooksLikePatch(content: string): boolean {
  return (
    content.includes("<<<<<<< SEARCH") ||
    /```patch\b/i.test(content) ||
    /^File:\s+/m.test(content)
  );
}

/** `file: src/foo.ts · selection: L1–2` chips stored on /edit user bubbles. */
export function filePathFromEditHistoryContent(content: string | undefined): string | undefined {
  if (!content?.trim()) {
    return undefined;
  }
  for (const line of content.split(/\r?\n/)) {
    const match = /(?:^|·\s*)file:\s+([^\s·]+)/i.exec(line.trim());
    const path = match?.[1]?.trim();
    if (path) {
      return path;
    }
  }
  return undefined;
}

/**
 * Rebuild in-memory Patch cards from persisted thread messages.
 * Live /edit already upserts; reopen / reload has the markdown but not the session.
 * Existing records (applied / rejected) are left alone.
 */
export function hydratePatchCardsFromHistory(
  messages: readonly HistoryPatchMessage[],
  options?: { fileContents?: Readonly<Record<string, string>> }
): number {
  let hydrated = 0;
  let previousUser: HistoryPatchMessage | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      previousUser = message;
    }
    if (message.role !== "assistant") {
      continue;
    }
    const existing = getPatchRecord(message.timestamp);
    const retryFailedEmpty =
      existing?.card.status === "failed" &&
      existing.card.files.length === 0 &&
      existing.card.error !== COMMENT_ONLY_REWRITE_REJECTED_ERROR;
    if (existing && !retryFailedEmpty) {
      continue;
    }
    if (!messageLooksLikePatch(message.content)) {
      continue;
    }
    const preferredFile = filePathFromEditHistoryContent(previousUser?.content);
    const savedCard = message.patchCard?.messageTimestamp === message.timestamp
      ? message.patchCard
      : undefined;
    const parsed = parsePatchResponse(message.content, {
      preferredFile,
      targetAliases: savedCard ? sanitizedPatchTargetBindings(savedCard.files.map(file => file.relativePath)) : undefined
    });
    if (!parsed.ok) {
      markMessageMarkdownSuppressed(message.timestamp);
      continue;
    }
    const patches = snapPatchSetToSelection(parsed.patches, {
      preferredFile,
      readContent: (relativePath) =>
        lookupPatchFileContent(relativePath, options?.fileContents) ??
        collectOpenPatchFileBytes(relativePath)
    });
    const pending = withSuppressionRegistry({
      ...(savedCard
        ? { ...savedCard, canUndo: savedCard.status === "rejected" && savedCard.canUndo,
            canCreatePr: false }
        : buildPatchCardState(patches, {
        status: "pending",
        messageTimestamp: message.timestamp,
        fileContents: options?.fileContents
      })),
      suppressMarkdown: true
    });
    if (pending.files.length === 0) {
      markMessageMarkdownSuppressed(message.timestamp);
      continue;
    }
    upsertPatchRecord(message.timestamp, patches, pending, {
      fileContents: options?.fileContents ? { ...options.fileContents } : undefined
    });
    hydrated += 1;
  }
  return hydrated;
}

/** Store the card with its originating message, including partial hunk decisions. */
export function retainPatchCardsOnMessages(messages: ChatMessage[], cards = listPatchCards()): ChatMessage[] {
  const byTimestamp = new Map(cards.map(card => [card.messageTimestamp, card]));
  return messages.map(message => {
    const card = message.role === "assistant" ? byTimestamp.get(message.timestamp) : undefined;
    return card ? { ...message, patchCard: structuredClone(card) } : message;
  });
}

/** Cards that belong to the messages currently on screen — not other threads. */
export function patchCardsForMessages(
  messages: ReadonlyArray<{ timestamp: number }>
): PatchCardsUpdatePayload {
  const timestamps = new Set(messages.map((message) => message.timestamp));
  const cards = listPatchCards()
    .filter(
      (card) => card.messageTimestamp !== undefined && timestamps.has(card.messageTimestamp)
    )
    .map((card) => withSuppressionRegistry({ ...card, suppressMarkdown: true }));
  const cardStamps = cards
    .map((card) => card.messageTimestamp)
    .filter((value): value is number => typeof value === "number");
  const sessionStamps = getSuppressedMessageTimestamps().filter((stamp) => timestamps.has(stamp));
  const stamps = [...new Set([...cardStamps, ...sessionStamps])];
  return {
    cards: cards.map((card) => ({
      ...card,
      suppressedMessageTimestamps: stamps
    })),
    suppressedMessageTimestamps: stamps
  };
}
