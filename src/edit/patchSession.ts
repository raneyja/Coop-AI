import type { FileUndoSnapshot } from "./patchApplier";
import type { ParsedPatchSet } from "./patchParser";
import type { PatchCardState } from "../chat/types";

/** One selectable rewrite option for an assistant message. */
export type PatchVariantRecord = {
  id: string;
  label: string;
  index: number;
  patches: ParsedPatchSet;
  card: PatchCardState;
  undo?: FileUndoSnapshot[];
};

/**
 * All patch options produced by a single assistant message. Single-patch
 * replies hold exactly one variant; multi-option `/edit` replies hold several.
 */
export type PatchRecord = {
  messageTimestamp: number;
  variants: PatchVariantRecord[];
};

/** Fully-resolved target for an apply/reject/undo action. */
export type ResolvedVariant = {
  messageTimestamp: number;
  record: PatchRecord;
  variant: PatchVariantRecord;
};

let patchRecordsByMessage = new Map<number, PatchRecord>();
let lastEditUserMessage: string | undefined;
let lastAssistantPatchContent: string | undefined;
let lastPatchApplyError: string | undefined;
let lastPatchMessageTimestamp: number | undefined;
let suppressedMessageTimestamps: number[] = [];

export function setLastEditUserMessage(message: string): void {
  lastEditUserMessage = message;
}

export function getLastEditUserMessage(): string | undefined {
  return lastEditUserMessage;
}

export function setLastAssistantPatchContent(content: string): void {
  lastAssistantPatchContent = content;
}

export function getLastAssistantPatchContent(): string | undefined {
  return lastAssistantPatchContent;
}

export function setLastPatchApplyError(error: string | undefined): void {
  lastPatchApplyError = error;
}

export function getLastPatchApplyError(): string | undefined {
  return lastPatchApplyError;
}

export function setLastPatchMessageTimestamp(timestamp: number | undefined): void {
  lastPatchMessageTimestamp = timestamp;
}

export function getLastPatchMessageTimestamp(): number | undefined {
  return lastPatchMessageTimestamp;
}

export function markMessageMarkdownSuppressed(timestamp: number | undefined): void {
  if (timestamp === undefined || suppressedMessageTimestamps.includes(timestamp)) {
    return;
  }
  suppressedMessageTimestamps = [...suppressedMessageTimestamps, timestamp];
}

export function getSuppressedMessageTimestamps(): number[] {
  return suppressedMessageTimestamps;
}

/**
 * Replaces every variant for a message. Preserves any existing undo snapshots
 * for variants that keep the same id (so Undo survives a card refresh).
 */
export function upsertPatchVariants(
  timestamp: number,
  variants: ReadonlyArray<Omit<PatchVariantRecord, "undo">>
): void {
  const existing = patchRecordsByMessage.get(timestamp);
  const priorUndoById = new Map<string, FileUndoSnapshot[] | undefined>(
    existing?.variants.map((variant) => [variant.id, variant.undo]) ?? []
  );
  patchRecordsByMessage.set(timestamp, {
    messageTimestamp: timestamp,
    variants: variants.map((variant) => ({
      ...variant,
      card: { ...variant.card, messageTimestamp: timestamp, suppressMarkdown: true },
      undo: priorUndoById.get(variant.id)
    }))
  });
  markMessageMarkdownSuppressed(timestamp);
  lastPatchMessageTimestamp = timestamp;
}

export function updateVariantCard(timestamp: number, variantId: string, card: PatchCardState): void {
  const record = patchRecordsByMessage.get(timestamp);
  if (!record) {
    return;
  }
  record.variants = record.variants.map((variant) =>
    variant.id === variantId
      ? { ...variant, card: { ...card, messageTimestamp: timestamp, suppressMarkdown: true } }
      : variant
  );
  markMessageMarkdownSuppressed(timestamp);
}

export function setVariantUndo(
  timestamp: number,
  variantId: string,
  undo: FileUndoSnapshot[] | undefined
): void {
  const record = patchRecordsByMessage.get(timestamp);
  if (!record) {
    return;
  }
  record.variants = record.variants.map((variant) =>
    variant.id === variantId ? { ...variant, undo } : variant
  );
}

export function getRecord(timestamp: number | undefined): PatchRecord | undefined {
  if (timestamp === undefined) {
    return undefined;
  }
  return patchRecordsByMessage.get(timestamp);
}

/**
 * Resolves an action target. `variantId` pins a specific option; without it we
 * fall back to the sole variant, else the latest pending option (command
 * palette path where the user cannot pick an option).
 */
export function resolveVariant(
  preferredTimestamp?: number,
  variantId?: string
): ResolvedVariant | undefined {
  const timestamp = resolveActivePatchTimestamp(preferredTimestamp);
  const record = getRecord(timestamp);
  if (!record || timestamp === undefined || record.variants.length === 0) {
    return undefined;
  }

  let variant: PatchVariantRecord | undefined;
  if (variantId !== undefined) {
    variant = record.variants.find((entry) => entry.id === variantId);
  } else if (record.variants.length === 1) {
    variant = record.variants[0];
  } else {
    const pending = record.variants
      .filter((entry) => entry.card.status === "pending" || entry.card.status === "failed")
      .sort((a, b) => b.index - a.index);
    variant = pending[0] ?? record.variants[record.variants.length - 1];
  }

  return variant ? { messageTimestamp: timestamp, record, variant } : undefined;
}

/** Sibling variants sharing a message (excludes the given variant id). */
export function siblingVariants(timestamp: number, variantId: string): PatchVariantRecord[] {
  const record = patchRecordsByMessage.get(timestamp);
  if (!record) {
    return [];
  }
  return record.variants.filter((variant) => variant.id !== variantId);
}

export function listPatchCards(): PatchCardState[] {
  const cards: PatchCardState[] = [];
  for (const record of patchRecordsByMessage.values()) {
    for (const variant of record.variants) {
      const hasPreview = variant.card.files.length > 0;
      const isVisibleFailure = variant.card.status === "failed" && Boolean(variant.card.error);
      if (hasPreview || isVisibleFailure) {
        cards.push(variant.card);
      }
    }
  }
  return cards.sort((a, b) => {
    const byMessage = (a.messageTimestamp ?? 0) - (b.messageTimestamp ?? 0);
    return byMessage !== 0 ? byMessage : (a.variantIndex ?? 0) - (b.variantIndex ?? 0);
  });
}

export function resolveActivePatchTimestamp(preferred?: number): number | undefined {
  if (preferred !== undefined && patchRecordsByMessage.has(preferred)) {
    return preferred;
  }
  const hasStatus = (record: PatchRecord, status: PatchCardState["status"]): boolean =>
    record.variants.some((variant) => variant.card.status === status);

  const pending = [...patchRecordsByMessage.entries()]
    .filter(([, record]) => hasStatus(record, "pending"))
    .sort((a, b) => b[0] - a[0]);
  if (pending[0]) {
    return pending[0][0];
  }
  const settled = [...patchRecordsByMessage.entries()]
    .filter(([, record]) => hasStatus(record, "applied") || hasStatus(record, "rejected"))
    .sort((a, b) => b[0] - a[0]);
  if (settled[0]) {
    return settled[0][0];
  }
  return lastPatchMessageTimestamp;
}

/** Active pending patches for the command-palette Apply path. */
export function getPendingPatches(): ParsedPatchSet | undefined {
  const resolved = resolveVariant();
  if (!resolved) {
    return undefined;
  }
  return resolved.variant.card.status === "pending" ? resolved.variant.patches : undefined;
}

export function resetPatchSessionForTests(): void {
  patchRecordsByMessage = new Map();
  lastEditUserMessage = undefined;
  lastAssistantPatchContent = undefined;
  lastPatchApplyError = undefined;
  lastPatchMessageTimestamp = undefined;
  suppressedMessageTimestamps = [];
}
