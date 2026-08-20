import type { PatchCardsUpdatePayload } from "../chat/types";
import { buildPatchCardState, withSuppressionRegistry } from "./patchDiffPreview";
import { lookupPatchFileContent } from "./patchFileContents";
import { parsePatchResponse } from "./patchParser";
import { getPatchRecord, listPatchCards, upsertPatchRecord } from "./patchSession";
import { collectOpenPatchFileBytes } from "./patchTarget";
import { snapPatchSetToSelection } from "./snapPatchToSelection";

export type HistoryPatchMessage = {
  role: string;
  content: string;
  timestamp: number;
};

function messageLooksLikePatch(content: string): boolean {
  return (
    content.includes("<<<<<<< SEARCH") ||
    /```patch\b/i.test(content) ||
    /^File:\s+/m.test(content)
  );
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
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    if (getPatchRecord(message.timestamp)) {
      continue;
    }
    if (!messageLooksLikePatch(message.content)) {
      continue;
    }
    const parsed = parsePatchResponse(message.content);
    if (!parsed.ok) {
      continue;
    }
    const patches = snapPatchSetToSelection(parsed.patches, {
      readContent: (relativePath) =>
        lookupPatchFileContent(relativePath, options?.fileContents) ??
        collectOpenPatchFileBytes(relativePath)
    });
    const pending = withSuppressionRegistry({
      ...buildPatchCardState(patches, {
        status: "pending",
        messageTimestamp: message.timestamp,
        fileContents: options?.fileContents
      }),
      suppressMarkdown: true
    });
    if (pending.files.length === 0) {
      continue;
    }
    upsertPatchRecord(message.timestamp, patches, pending, {
      fileContents: options?.fileContents ? { ...options.fileContents } : undefined
    });
    hydrated += 1;
  }
  return hydrated;
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
  const stamps = cards
    .map((card) => card.messageTimestamp)
    .filter((value): value is number => typeof value === "number");
  return {
    cards: cards.map((card) => ({
      ...card,
      suppressedMessageTimestamps: stamps
    })),
    suppressedMessageTimestamps: stamps
  };
}
